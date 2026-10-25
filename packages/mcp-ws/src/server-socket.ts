// Accepting side of /mcp-ws (runs on the Node server). Framework-free: the HTTP
// layer feeds raw text in with receive() and reports the close with socketClosed().
//
// Flow: wait for hello -> check version -> onHello (auth, limits) -> send ready
// -> hand a FramedTransport to onReady, where the MCP Client connects.
import {
  CloseCode,
  HEARTBEAT_DEADLINE_MS,
  HEARTBEAT_INTERVAL_MS,
  HELLO_TIMEOUT_MS,
  decodeFrame,
  encodeCtl,
  isSupportedContracts,
  type Hello,
} from "@bigfish/contracts";
import { FramedTransport, type FrameSink } from "./framed-transport.js";
import { startLiveness, type Liveness } from "./liveness.js";

// Throw from onHello to refuse the connection with a specific close code.
export class HandshakeError extends Error {
  constructor(
    readonly code: number,
    reason: string,
  ) {
    super(reason);
  }
}

export interface ServerSocketOptions {
  connId: string;
  onHello?(hello: Hello): Promise<void> | void;
  onReady(transport: FramedTransport, hello: Hello): void;
  helloTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatDeadlineMs?: number;
}

type State = "awaiting_hello" | "authorizing" | "ready" | "closed";

export class ServerSocket {
  private state: State = "awaiting_hello";
  private transport: FramedTransport | null = null;
  private liveness: Liveness | null = null;
  private readonly helloTimer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly sink: FrameSink,
    private readonly opts: ServerSocketOptions,
  ) {
    this.helloTimer = setTimeout(
      () => this.close(CloseCode.HELLO_TIMEOUT, "hello not received"),
      opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS,
    );
  }

  receive(raw: string): void {
    if (this.state === "closed") return;
    const frame = decodeFrame(raw);
    if (!frame) return this.close(CloseCode.BAD_FRAME, "invalid frame");
    this.liveness?.touch();

    if (this.state === "awaiting_hello") {
      if (frame.k !== "ctl" || frame.c.t !== "hello") return this.close(CloseCode.BAD_FRAME, "expected hello");
      void this.acceptHello(frame.c);
      return;
    }
    if (this.state === "authorizing") return this.close(CloseCode.BAD_FRAME, "frame before ready");

    if (frame.k === "mcp") return this.transport?.deliver(frame.m);
    if (frame.c.t === "hb") return;
    this.close(CloseCode.BAD_FRAME, `unexpected control ${frame.c.t}`);
  }

  socketClosed(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.cleanup();
    this.transport?.socketClosed();
  }

  close(code: number, reason: string): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.cleanup();
    if (this.transport) this.transport.closeWith(code, reason);
    else safeClose(this.sink, code, reason);
  }

  private async acceptHello(hello: Hello): Promise<void> {
    clearTimeout(this.helloTimer);
    this.state = "authorizing";
    if (!isSupportedContracts(hello.contracts)) {
      return this.close(CloseCode.UPGRADE_REQUIRED, `contracts ${hello.contracts} not supported`);
    }
    try {
      await this.opts.onHello?.(hello);
    } catch (err) {
      if (err instanceof HandshakeError) return this.close(err.code, err.message);
      return this.close(CloseCode.INIT_FAILED, "hello rejected");
    }
    // The socket may have closed while onHello was running.
    if (this.state !== "authorizing") return;

    this.transport = new FramedTransport(this.sink, this.opts.connId);
    this.sink.send(encodeCtl({ t: "ready", connId: this.opts.connId }));
    this.state = "ready";
    this.liveness = startLiveness({
      intervalMs: this.opts.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      deadlineMs: this.opts.heartbeatDeadlineMs ?? HEARTBEAT_DEADLINE_MS,
      sendBeat: () => this.sink.send(encodeCtl({ t: "hb" })),
      onDead: () => this.dropDeadPeer(),
    });
    this.opts.onReady(this.transport, hello);
  }

  private dropDeadPeer(): void {
    if (this.state === "closed") return;
    if (this.sink.terminate) {
      this.state = "closed";
      this.cleanup();
      this.sink.terminate();
      this.transport?.socketClosed();
      return;
    }
    this.close(CloseCode.HEARTBEAT_TIMEOUT, "heartbeat timeout");
  }

  private cleanup(): void {
    clearTimeout(this.helloTimer);
    this.liveness?.stop();
  }
}

function safeClose(sink: FrameSink, code: number, reason: string): void {
  try {
    sink.close(code, reason);
  } catch {
    // Socket already gone.
  }
}
