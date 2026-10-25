// MCP Transport over one framed WebSocket. The socket owner (client-socket or
// server-socket) parses frames and feeds "mcp" ones in through deliver().
import { CloseCode, encodeMcp } from "@bigfish/contracts";

export interface FrameSink {
  send(text: string): void;
  close(code: number, reason: string): void;
  // Drop the socket without a closing handshake (dead peer).
  terminate?(): void;
}

type JsonRpcMessage = { jsonrpc: "2.0"; [key: string]: unknown };

// Messages that arrive before the SDK calls start() wait here, up to this many.
const MAX_PENDING = 64;

export class FramedTransport {
  onmessage?: (message: any, extra?: any) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  private started = false;
  private closed = false;
  private pending: JsonRpcMessage[] = [];

  // Not named `sessionId`: the MCP client treats a transport with a sessionId
  // as an already-initialized session and skips the initialize handshake.
  constructor(
    private readonly sink: FrameSink,
    readonly connId: string,
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("FramedTransport already started");
    this.started = true;
    const queued = this.pending;
    this.pending = [];
    for (const message of queued) this.onmessage?.(message);
  }

  async send(message: unknown): Promise<void> {
    if (this.closed) throw new Error("Transport closed");
    try {
      this.sink.send(encodeMcp(message));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.onerror?.(error);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closeWith(CloseCode.NORMAL, "transport closed");
  }

  // Close the socket with an app close code, e.g. REPLACED.
  closeWith(code: number, reason: string): void {
    if (this.closed) return;
    try {
      this.sink.close(code, reason);
    } catch {
      // Socket already gone.
    }
    this.markClosed();
  }

  // Socket owner: an "mcp" frame arrived.
  deliver(message: JsonRpcMessage): void {
    if (this.closed) return;
    if (this.started) {
      this.onmessage?.(message);
      return;
    }
    if (this.pending.length >= MAX_PENDING) {
      this.closeWith(CloseCode.BAD_FRAME, "too many frames before start");
      return;
    }
    this.pending.push(message);
  }

  // Socket owner: the socket closed from the other side or the network.
  socketClosed(): void {
    this.markClosed();
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending = [];
    this.onclose?.();
  }
}
