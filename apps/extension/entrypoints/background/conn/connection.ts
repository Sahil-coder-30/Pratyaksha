// Keeps one MCP connection to the server alive from the MV3 service worker.
//
// States: signed_out | idle -> ticket -> connecting (socket + hello/ready) ->
// mcp_init -> ready. A drop goes to backoff and tries again, except for the
// close codes that mean "stop" (replaced, too many devices, extension too old,
// kill switch). ensureConnected() is safe to call any time, from anywhere.
import { CloseCode, NO_RECONNECT_CODES } from "@bigfish/contracts";
import { SocketOpenError, openMcpSocket, type McpSocket } from "@bigfish/mcp-ws";
import type { McpServer } from "@modelcontextprotocol/server";
import { SignInRequiredError, dropJwt, getAuth } from "../auth.js";
import { EXT_VERSION, SERVER_URL, WS_URL, getDeviceId } from "../config.js";
import { buildMcpServer } from "../mcp/server.js";

export type ConnState = "signed_out" | "idle" | "ticket" | "connecting" | "mcp_init" | "ready" | "backoff" | "stopped";

export interface ConnStatus {
  state: ConnState;
  detail?: string;
}

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
// A connection that stays up this long resets the backoff.
const STABLE_RESET_MS = 60_000;
// Survives service worker restarts, cleared when the browser closes.
const KILLED_KEY = "bigfish.killed";

const STOP_REASONS: Record<number, string> = {
  [CloseCode.NORMAL]: "Closed by the server.",
  [CloseCode.REPLACED]: "Replaced by a newer connection for this device.",
  [CloseCode.TOO_MANY_DEVICES]: "Too many devices for this account. Disconnect one and retry.",
  [CloseCode.UPGRADE_REQUIRED]: "This extension is too old for the server. Update BigFish.",
};

class UnauthorizedError extends Error {}

export class Connection {
  private status: ConnStatus = { state: "idle" };
  private attempt: Promise<void> | null = null;
  private socket: McpSocket | null = null;
  private server: McpServer | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  // Set while stopped on purpose. Only resume() clears it.
  private stopReason: string | null = null;

  constructor(private readonly onStatus: (status: ConnStatus) => void) {}

  getStatus(): ConnStatus {
    return this.status;
  }

  ensureConnected(): void {
    if (this.attempt || this.socket || this.retryTimer || this.stopReason) return;
    this.attempt = this.connectOnce().finally(() => (this.attempt = null));
  }

  // After sign-in, or the user pressing "Connect": forget any stop and try now.
  async resume(): Promise<void> {
    await browser.storage.session.remove(KILLED_KEY);
    this.stopReason = null;
    this.failures = 0;
    this.clearRetry();
    this.ensureConnected();
  }

  // Kill switch: close with 1000 and do not reconnect until resume().
  async kill(): Promise<void> {
    await browser.storage.session.set({ [KILLED_KEY]: true });
    this.stop("stopped", "Kill switch is on.");
  }

  // Sign out: close and wait for the next sign-in.
  signedOut(): void {
    this.stop("signed_out", "Signed out.");
  }

  private stop(state: "stopped" | "signed_out", reason: string): void {
    this.stopReason = reason;
    this.clearRetry();
    this.dropSocket()?.close(CloseCode.NORMAL, reason);
    this.set(state, reason);
  }

  // Forget the current socket, so its close event is not taken as a server close.
  private dropSocket(): McpSocket | null {
    const socket = this.socket;
    this.socket = null;
    void this.server?.close().catch(() => {});
    this.server = null;
    return socket;
  }

  private async connectOnce(): Promise<void> {
    const killed = await browser.storage.session.get(KILLED_KEY);
    if (killed[KILLED_KEY]) {
      this.stopReason = "Kill switch is on.";
      return this.set("stopped", this.stopReason);
    }

    let ticket: string;
    try {
      ticket = await this.fetchTicket();
    } catch (err) {
      if (err instanceof SignInRequiredError) return this.set("signed_out", err.message);
      return this.scheduleRetry(`Server unreachable: ${errorText(err)}`);
    }
    if (this.stopReason) return;

    this.set("connecting");
    let socket: McpSocket;
    try {
      socket = await openMcpSocket({
        url: `${WS_URL}?ticket=${encodeURIComponent(ticket)}`,
        deviceId: await getDeviceId(),
        ext: EXT_VERSION,
      });
    } catch (err) {
      // A refused upgrade (bad ticket, wrong Origin) shows up as 1006 here.
      return this.onClosed(err instanceof SocketOpenError ? err.code : 1006, errorText(err));
    }
    if (this.stopReason) return socket.close(CloseCode.NORMAL, this.stopReason);

    this.set("mcp_init");
    const server = buildMcpServer();
    try {
      await server.connect(socket.transport);
    } catch (err) {
      socket.close(CloseCode.INIT_FAILED, "mcp init failed");
      return this.onClosed(CloseCode.INIT_FAILED, errorText(err));
    }

    this.socket = socket;
    this.server = server;
    this.set("ready");
    this.stableTimer = setTimeout(() => (this.failures = 0), STABLE_RESET_MS);
    void socket.closed.then(({ code, reason }) => {
      if (this.socket !== socket) return;
      this.dropSocket();
      this.onClosed(code, reason);
    });
  }

  // One retry with a fresh JWT if the server says ours is no longer valid.
  private async fetchTicket(): Promise<string> {
    this.set("ticket");
    try {
      return await requestTicket((await getAuth()).token);
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
      await dropJwt();
      return requestTicket((await getAuth()).token);
    }
  }

  private onClosed(code: number, reason: string): void {
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = null;
    if (this.stopReason) return;
    if (code === CloseCode.NORMAL || NO_RECONNECT_CODES.has(code)) {
      this.stopReason = STOP_REASONS[code] ?? `Closed (${code}).`;
      return this.set("stopped", this.stopReason);
    }
    this.scheduleRetry(`Disconnected (${code}${reason ? `: ${reason}` : ""}).`);
  }

  // Full jitter: random(0, min(30s, 1s * 2^n)).
  private scheduleRetry(detail: string): void {
    const delay = Math.random() * Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.failures);
    this.failures++;
    this.set("backoff", detail);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private set(state: ConnState, detail?: string): void {
    this.status = { state, detail };
    this.onStatus(this.status);
  }
}

async function requestTicket(jwt: string): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/ws-ticket`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } });
  if (res.status === 401) throw new UnauthorizedError("JWT refused");
  const body = (await res.json().catch(() => ({}))) as { ticket?: string };
  if (!res.ok || !body.ticket) throw new Error(`ws-ticket failed (${res.status})`);
  return body.ticket;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
