// BigFish Approval Manager: risky actions wait here until the user approves or
// denies them in the side panel (or the approval popup).

export interface ApprovalRequest {
  id: string;
  tool: string;
  args: any;
  reason: string;
  origin: string;
  fingerprint: string;
  createdAt: number;
}

export interface WaitOptions {
  timeoutMs?: number;
  // Aborted when the run is cancelled: counts as a denial.
  signal?: AbortSignal;
  // Called every PROGRESS_EVERY_MS while waiting, so the caller's timeout does not fire.
  onProgress?: (message: string) => void;
}

export type Decision = "approved" | "denied" | "timeout";

const DEFAULT_TIMEOUT_MS = 120_000;
const PROGRESS_EVERY_MS = 10_000;

class ApprovalManager {
  private pending: Map<string, { request: ApprovalRequest; resolve: (decision: Decision) => void }> = new Map();
  private listeners: ((req: ApprovalRequest) => void)[] = [];
  private closedListeners: ((id: string) => void)[] = [];

  computeActionFingerprint(tool: string, args: any, origin: string): string {
    const raw = `${tool}:${JSON.stringify(args)}:${origin}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  onApprovalRequested(listener: (req: ApprovalRequest) => void) {
    this.listeners.push(listener);
  }

  // Fired when a request ends for any reason, so open approval cards can go away.
  onApprovalClosed(listener: (id: string) => void) {
    this.closedListeners.push(listener);
  }

  // Every decision is for this one action only. Nothing is remembered for later calls.
  async waitForDecision(request: ApprovalRequest, opts: WaitOptions = {}): Promise<Decision> {
    if (opts.signal?.aborted) return "denied";

    return new Promise<Decision>((resolve) => {
      const started = Date.now();
      const finish = (decision: Decision) => {
        clearTimeout(timer);
        clearInterval(ticker);
        opts.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(request.id);
        for (const listener of this.closedListeners) listener(request.id);
        resolve(decision);
      };
      const onAbort = () => finish("denied");
      const timer = setTimeout(() => finish("timeout"), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const ticker = setInterval(
        () => opts.onProgress?.(`Waiting for approval (${Math.round((Date.now() - started) / 1000)}s): ${request.reason}`),
        PROGRESS_EVERY_MS,
      );
      opts.signal?.addEventListener("abort", onAbort);
      this.pending.set(request.id, { request, resolve: finish });

      opts.onProgress?.(`Waiting for approval: ${request.reason}`);
      for (const listener of this.listeners) {
        try {
          listener(request);
        } catch (e) {
          console.error("[BigFish Approval] Listener error", e);
        }
      }
    });
  }

  resolveDecision(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.resolve(approved ? "approved" : "denied");
    return true;
  }

  getPending(id: string): ApprovalRequest | undefined {
    return this.pending.get(id)?.request;
  }

  getPendingList(): ApprovalRequest[] {
    return Array.from(this.pending.values()).map((p) => p.request);
  }
}

export const approvals = new ApprovalManager();
