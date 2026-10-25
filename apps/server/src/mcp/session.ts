// One connected extension = one DeviceSession = one MCP Client.
// Tool calls on a device run one at a time, in order, because they all act on
// the same browser.
import { Client, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import { CloseCode, ErrorCode, TOOL_NAMES } from "@bigfish/contracts";
import type { FramedTransport } from "@bigfish/mcp-ws";

export type SessionState = "ready" | "closed";

export interface SessionInfo {
  connId: string;
  userId: string;
  deviceId: string;
  ext: string;
}

export interface CallOptions {
  runId?: string;
  toolCallId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  // Each progress notification restarts timeoutMs (e.g. while the user approves).
  onProgress?: (progress: { progress: number; total?: number; message?: string }) => void;
}

export const DEFAULT_TOOL_TIMEOUT_MS = 45_000;
// Hard cap even while progress keeps arriving.
export const MAX_TOOL_TIMEOUT_MS = 150_000;

// Connection-level failure. Tool-level failures come back as isError results instead.
export class SessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class DeviceSession {
  state: SessionState = "ready";
  readonly connectedAt = Date.now();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly closeListeners: Array<() => void> = [];

  private constructor(
    readonly info: SessionInfo,
    readonly client: Client,
    readonly tools: Tool[],
    private readonly transport: FramedTransport,
  ) {}

  // Runs the MCP handshake and tools/list. Closes the socket if either fails.
  static async open(
    transport: FramedTransport,
    info: SessionInfo,
    allowed: ReadonlySet<string> = TOOL_NAMES,
  ): Promise<DeviceSession> {
    const client = new Client({ name: "bigfish-server", version: "0.1.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const session = new DeviceSession(
        info,
        client,
        tools.filter((tool) => allowed.has(tool.name)),
        transport,
      );
      client.onclose = () => session.markClosed();
      if (transport.isClosed) session.markClosed();
      return session;
    } catch (err) {
      transport.closeWith(CloseCode.INIT_FAILED, "mcp init failed");
      throw err;
    }
  }

  get key(): string {
    return sessionKey(this.info.userId, this.info.deviceId);
  }

  hasTool(name: string): boolean {
    return this.tools.some((tool) => tool.name === name);
  }

  callTool(name: string, args: Record<string, unknown> = {}, opts: CallOptions = {}): Promise<CallToolResult> {
    if (!this.hasTool(name)) {
      return Promise.reject(new SessionError(ErrorCode.UNKNOWN_TOOL, `Tool ${name} is not available on this device.`));
    }
    return this.serialize(() => {
      if (this.state === "closed") {
        throw new SessionError(ErrorCode.NOT_CONNECTED, "Extension disconnected.");
      }
      return this.client.callTool(
        { name, arguments: args, _meta: { runId: opts.runId, toolCallId: opts.toolCallId } },
        {
          signal: opts.signal,
          timeout: opts.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: MAX_TOOL_TIMEOUT_MS,
          onprogress: opts.onProgress,
        },
      ) as Promise<CallToolResult>;
    });
  }

  close(code: number = CloseCode.NORMAL, reason = "session closed"): void {
    this.transport.closeWith(code, reason);
    this.markClosed();
  }

  onClose(listener: () => void): void {
    if (this.state === "closed") listener();
    else this.closeListeners.push(listener);
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => {});
    return run;
  }

  private markClosed(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    for (const listener of this.closeListeners.splice(0)) listener();
  }
}

export function sessionKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}
