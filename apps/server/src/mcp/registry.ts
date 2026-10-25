// Live extension sessions on this server process, keyed by userId:deviceId.
// Single-process for now. Multi-pod presence (Redis) plugs in behind this API.
import { CloseCode } from "@bigfish/contracts";
import { type DeviceSession, sessionKey } from "./session.js";

export const MAX_DEVICES_PER_USER = 3;

export class SessionRegistry {
  private readonly sessions = new Map<string, DeviceSession>();
  private readonly waiters = new Map<string, Set<(session: DeviceSession) => void>>();

  // A newer connection for the same device replaces the old one.
  add(session: DeviceSession): void {
    const key = session.key;
    const previous = this.sessions.get(key);
    this.sessions.set(key, session);
    const waiting = this.waiters.get(key);
    this.waiters.delete(key);
    for (const resolve of waiting ?? []) resolve(session);
    // Only remove the entry if it still points at this session, so a replaced
    // session closing late does not drop its replacement.
    session.onClose(() => {
      if (this.sessions.get(key) === session) this.sessions.delete(key);
    });
    if (previous && previous !== session) previous.close(CloseCode.REPLACED, "replaced by a newer connection");
  }

  get(userId: string, deviceId: string): DeviceSession | undefined {
    const session = this.sessions.get(sessionKey(userId, deviceId));
    return session?.state === "ready" ? session : undefined;
  }

  // The ready session, or the next one to connect within timeoutMs (e.g. after a
  // service worker restart). Undefined on timeout or abort.
  waitFor(userId: string, deviceId: string, timeoutMs: number, signal?: AbortSignal): Promise<DeviceSession | undefined> {
    const current = this.get(userId, deviceId);
    if (current || timeoutMs <= 0 || signal?.aborted) return Promise.resolve(current);
    const key = sessionKey(userId, deviceId);
    return new Promise((resolve) => {
      const waiting = this.waiters.get(key) ?? new Set();
      this.waiters.set(key, waiting);
      const done = (session?: DeviceSession) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        waiting.delete(done);
        resolve(session);
      };
      const onAbort = () => done();
      const timer = setTimeout(done, timeoutMs);
      signal?.addEventListener("abort", onAbort);
      waiting.add(done);
    });
  }

  listForUser(userId: string): DeviceSession[] {
    return [...this.sessions.values()].filter((s) => s.info.userId === userId);
  }

  all(): DeviceSession[] {
    return [...this.sessions.values()];
  }

  get size(): number {
    return this.sessions.size;
  }

  closeAll(code: number = CloseCode.SERVICE_RESTART, reason = "server shutting down"): void {
    for (const session of this.sessions.values()) session.close(code, reason);
    this.sessions.clear();
  }
}
