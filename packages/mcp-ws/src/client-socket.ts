// Dialing side of /mcp-ws (runs in the extension service worker, or in Node for
// the fake extension). Opens the socket, sends hello, waits for ready, then
// returns a FramedTransport for the extension's McpServer to connect to.
//
// One call = one socket. Reconnecting is the caller's job.
import {
  CONTRACTS_VERSION,
  CloseCode,
  HEARTBEAT_DEADLINE_MS,
  HEARTBEAT_INTERVAL_MS,
  HELLO_TIMEOUT_MS,
  decodeFrame,
  encodeCtl,
} from "@bigfish/contracts";
import { FramedTransport, type FrameSink } from "./framed-transport.js";
import { startLiveness, type Liveness } from "./liveness.js";

export interface OpenMcpSocketOptions {
  url: string;
  deviceId: string;
  ext: string;
  contracts?: number;
  readyTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatDeadlineMs?: number;
  WebSocketImpl?: typeof WebSocket;
}

export interface SocketClosed {
  code: number;
  reason: string;
}

export interface McpSocket {
  readonly connId: string;
  readonly transport: FramedTransport;
  // Resolves once, when the socket is gone (closed, dropped or declared dead).
  readonly closed: Promise<SocketClosed>;
  close(code?: number, reason?: string): void;
}

// The socket closed before ready. code tells the caller whether to retry.
export class SocketOpenError extends Error {
  constructor(
    readonly code: number,
    reason: string,
  ) {
    super(reason);
  }
}

export function openMcpSocket(opts: OpenMcpSocketOptions): Promise<McpSocket> {
  const WS = opts.WebSocketImpl ?? globalThis.WebSocket;

  return new Promise((resolve, reject) => {
    const ws = new WS(opts.url);
    const sink: FrameSink = {
      send: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
    };

    let transport: FramedTransport | null = null;
    let liveness: Liveness | null = null;
    let opened = false;
    let finished = false;
    let resolveClosed!: (value: SocketClosed) => void;
    const closed = new Promise<SocketClosed>((r) => (resolveClosed = r));

    const readyTimer = setTimeout(
      () => failBeforeReady(CloseCode.HELLO_TIMEOUT, "ready not received"),
      opts.readyTimeoutMs ?? HELLO_TIMEOUT_MS * 2,
    );

    function failBeforeReady(code: number, reason: string): void {
      if (opened || finished) return;
      finish(code, reason);
      try {
        ws.close(code, reason);
      } catch {
        // Socket already gone.
      }
    }

    function finish(code: number, reason: string): void {
      if (finished) return;
      finished = true;
      clearTimeout(readyTimer);
      liveness?.stop();
      if (!opened) reject(new SocketOpenError(code, reason || "closed before ready"));
      transport?.socketClosed();
      resolveClosed({ code, reason });
    }

    function onReady(connId: string): void {
      opened = true;
      clearTimeout(readyTimer);
      const t = new FramedTransport(sink, connId);
      transport = t;
      liveness = startLiveness({
        intervalMs: opts.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
        deadlineMs: opts.heartbeatDeadlineMs ?? HEARTBEAT_DEADLINE_MS,
        sendBeat: () => ws.send(encodeCtl({ t: "hb" })),
        onDead: () => {
          t.closeWith(CloseCode.HEARTBEAT_TIMEOUT, "heartbeat timeout");
          finish(CloseCode.HEARTBEAT_TIMEOUT, "heartbeat timeout");
        },
      });
      resolve({
        connId,
        transport: t,
        closed,
        close: (code = CloseCode.NORMAL, reason = "client closed") => t.closeWith(code, reason),
      });
    }

    ws.addEventListener("open", () => {
      ws.send(
        encodeCtl({
          t: "hello",
          deviceId: opts.deviceId,
          ext: opts.ext,
          contracts: opts.contracts ?? CONTRACTS_VERSION,
        }),
      );
    });

    ws.addEventListener("message", (event) => {
      if (finished) return;
      const frame = typeof event.data === "string" ? decodeFrame(event.data) : null;
      if (!frame) {
        if (transport) transport.closeWith(CloseCode.BAD_FRAME, "invalid frame");
        else failBeforeReady(CloseCode.BAD_FRAME, "invalid frame");
        return;
      }
      liveness?.touch();

      if (!transport) {
        if (frame.k === "ctl" && frame.c.t === "ready") onReady(frame.c.connId);
        else failBeforeReady(CloseCode.BAD_FRAME, "expected ready");
        return;
      }
      if (frame.k === "mcp") transport.deliver(frame.m);
      else if (frame.c.t !== "hb") transport.closeWith(CloseCode.BAD_FRAME, `unexpected control ${frame.c.t}`);
    });

    ws.addEventListener("close", (event) => finish(event.code, event.reason));
    // An error event is always followed by close, which does the cleanup.
    ws.addEventListener("error", () => {});
  });
}
