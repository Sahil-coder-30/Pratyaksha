// BigFish agent: loop guard, per subtask. Refused, so the model has to try something else:
// - the same tool with the same args 3 times in a row,
// - a call that already failed twice with the same args (even with other calls in between,
//   e.g. reload, snapshot, reload, snapshot),
// - the same two actions taking turns (back, forward, back, forward ...). Reads do not
//   count, so paging with scroll + snapshot is fine.
import { ErrorCode, toolError } from "@bigfish/contracts";
import { isReadOnlyTool } from "./tool-policy.js";

export const LOOP_REPEAT_LIMIT = 3;
export const LOOP_FAILURE_LIMIT = 2;
// This many actions in a row that are only two different calls is a ping-pong.
export const LOOP_CYCLE_WINDOW = 6;

export class LoopGuard {
  private lastKey = "";
  private repeats = 0;
  private readonly failures = new Map<string, number>();
  private readonly recent: string[] = [];

  // Returns an ERROR line when the call should be refused, otherwise null.
  check(name: string, args: Record<string, unknown>): string | null {
    const key = callKey(name, args);
    this.repeats = key === this.lastKey ? this.repeats + 1 : 1;
    this.lastKey = key;
    const window = isReadOnlyTool(name) ? this.recent : [...this.recent, key].slice(-LOOP_CYCLE_WINDOW);
    this.recent.splice(0, this.recent.length, ...window);
    if (!isReadOnlyTool(name) && window.length === LOOP_CYCLE_WINDOW && new Set(window).size <= 2) {
      return toolError(
        ErrorCode.LOOP,
        `${name} keeps taking turns with the same other call.`,
        "Stop going back and forth. Read the last result: you may already be done. Else try another way, or call fail_subtask.",
      );
    }
    const failed = this.failures.get(key) ?? 0;
    if (failed >= LOOP_FAILURE_LIMIT) {
      return toolError(
        ErrorCode.LOOP,
        `${name} already failed ${failed} times with these arguments.`,
        "Repeating it will not help. Try another way, or call fail_subtask with the reason.",
      );
    }
    if (this.repeats < LOOP_REPEAT_LIMIT) return null;
    return toolError(
      ErrorCode.LOOP,
      `${name} was called ${this.repeats} times in a row with the same arguments.`,
      "Try a different tool or different arguments, or call fail_subtask.",
    );
  }

  // Called with each browser result, so repeated failures are counted.
  record(name: string, args: Record<string, unknown>, ok: boolean): void {
    if (ok) return;
    const key = callKey(name, args);
    this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
  }
}

function callKey(name: string, args: Record<string, unknown>): string {
  return `${name} ${stableJson(args)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
