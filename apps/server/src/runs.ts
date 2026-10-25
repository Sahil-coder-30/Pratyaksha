// BigFish agent runs: one AbortController per run, one run per device at a time.
import { randomUUID } from "node:crypto";
import { AgentErrorCode } from "@bigfish/contracts";
import { sessionKey } from "./mcp/session.js";

// The abort reason of a run, so the stream can say why it stopped.
export class RunStopped extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class RunInProgressError extends Error {}

export interface Run {
  runId: string;
  userId: string;
  deviceId: string;
  controller: AbortController;
  startedAt: number;
}

export class RunRegistry {
  private readonly byId = new Map<string, Run>();
  private readonly byDevice = new Map<string, string>();

  // Throws RunInProgressError if this device already has a run.
  start(userId: string, deviceId: string): Run {
    const key = sessionKey(userId, deviceId);
    const active = this.byDevice.get(key);
    if (active) throw new RunInProgressError(`Run ${active} is still in progress on this device.`);
    const run: Run = { runId: randomUUID(), userId, deviceId, controller: new AbortController(), startedAt: Date.now() };
    this.byId.set(run.runId, run);
    this.byDevice.set(key, run.runId);
    return run;
  }

  // Only the run's own user can cancel it. False if unknown or not theirs.
  cancel(userId: string, runId: string): boolean {
    const run = this.byId.get(runId);
    if (!run || run.userId !== userId) return false;
    run.controller.abort(new RunStopped(AgentErrorCode.CANCELLED, "Run cancelled by the user."));
    return true;
  }

  // Server shutdown: stop every run.
  abortAll(reason: RunStopped): void {
    for (const run of this.byId.values()) run.controller.abort(reason);
  }

  finish(run: Run): void {
    this.byId.delete(run.runId);
    const key = sessionKey(run.userId, run.deviceId);
    if (this.byDevice.get(key) === run.runId) this.byDevice.delete(key);
  }

  get size(): number {
    return this.byId.size;
  }
}
