// Heartbeat for one socket. Sends a beat every intervalMs and calls onDead when
// nothing has arrived for deadlineMs. Both ends run one, because a browser
// WebSocket cannot see protocol-level ping frames.
export interface LivenessOptions {
  intervalMs: number;
  deadlineMs: number;
  sendBeat(): void;
  onDead(): void;
}

export interface Liveness {
  touch(): void;
  stop(): void;
}

export function startLiveness(opts: LivenessOptions): Liveness {
  let lastSeen = Date.now();
  let lastSent = Date.now();
  const tickMs = Math.max(10, Math.min(opts.intervalMs, Math.floor(opts.deadlineMs / 3)));

  const timer = setInterval(() => {
    const now = Date.now();
    if (now - lastSeen > opts.deadlineMs) {
      clearInterval(timer);
      opts.onDead();
      return;
    }
    if (now - lastSent >= opts.intervalMs) {
      lastSent = now;
      try {
        opts.sendBeat();
      } catch {
        // The close handler cleans up.
      }
    }
  }, tickMs);
  // Do not keep a Node process alive just for heartbeats.
  (timer as { unref?: () => void }).unref?.();

  return {
    touch() {
      lastSeen = Date.now();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
