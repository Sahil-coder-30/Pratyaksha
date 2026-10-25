// POST /api/agent/invoke { deviceId, prompt }: runs the agent on one of the
// user's devices and streams AgentEvents as SSE until final or error.
// POST /api/agent/cancel { runId }: stops a run of the same user.
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { AgentErrorCode, ApiErrorCode, RUN_LIMITS, type AgentEvent } from "@bigfish/contracts";
import type { UserEnv } from "../auth/middleware.js";
import { ToolLimitError, type AgentLimits, type AgentRunContext } from "../agent/actor.js";
import { runAgent } from "../agent/graph.js";
import type { AgentModels } from "../agent/models.js";
import type { SessionRegistry } from "../mcp/registry.js";
import { RunInProgressError, RunStopped, type RunRegistry } from "../runs.js";

export interface AgentDeps {
  registry: SessionRegistry;
  runs: RunRegistry;
  // Unset when no model is configured: invoke answers 503.
  models?: AgentModels;
  limits?: Partial<AgentLimits & { maxDurationMs: number }>;
  // Reconnect grace for tool calls (tests use a short one).
  graceMs?: number;
}

const MAX_SUBTASK_TOOL_CALLS = 30;
// A comment line now and then, so proxies and clients do not drop a quiet stream
// while a slow model or a long wait_for runs.
const HEARTBEAT_MS = 15_000;
const ERROR_MESSAGE_LIMIT = 200;

export function agentController(deps: AgentDeps) {
  const limits: AgentLimits = {
    maxToolCalls: deps.limits?.maxToolCalls ?? RUN_LIMITS.maxToolCalls,
    maxSubtaskToolCalls: deps.limits?.maxSubtaskToolCalls ?? MAX_SUBTASK_TOOL_CALLS,
  };
  const maxDurationMs = deps.limits?.maxDurationMs ?? RUN_LIMITS.maxDurationMs;

  async function invoke(c: Context<UserEnv>) {
    const models = deps.models;
    if (!models) {
      return c.json({ ok: false, code: ApiErrorCode.AGENT_NOT_CONFIGURED, message: "No agent model is configured." }, 503);
    }
    const body = await c.req.json().catch(() => null);
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId : "";
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!deviceId || !prompt || prompt.length > RUN_LIMITS.maxPromptChars) {
      return c.json(
        { ok: false, code: ApiErrorCode.BAD_REQUEST, message: `deviceId and a prompt of 1 to ${RUN_LIMITS.maxPromptChars} characters are required.` },
        400,
      );
    }

    const userId = c.get("userId");
    // Looked up under the JWT user, so another user's device is simply not found.
    if (!deps.registry.get(userId, deviceId)) {
      return c.json({ ok: false, code: ApiErrorCode.NOT_FOUND, message: "That device is not connected for this account." }, 404);
    }

    let run;
    try {
      run = deps.runs.start(userId, deviceId);
    } catch (err) {
      if (err instanceof RunInProgressError) {
        return c.json({ ok: false, code: ApiErrorCode.RUN_IN_PROGRESS, message: err.message }, 409);
      }
      throw err;
    }

    return streamSSE(c, async (stream) => {
      const { signal } = run.controller;
      // Writes are queued so events keep their order.
      let writes = Promise.resolve();
      const emit = (event: AgentEvent) => {
        writes = writes.then(() => stream.writeSSE({ event: event.type, data: JSON.stringify(event) })).catch(() => {});
      };
      stream.onAbort(() => run.controller.abort(new RunStopped(AgentErrorCode.CANCELLED, "The client disconnected.")));
      const heartbeat = setInterval(() => {
        writes = writes.then(() => stream.write(": keepalive\n\n")).then(() => {}, () => {});
      }, HEARTBEAT_MS);
      const timer = setTimeout(
        () => run.controller.abort(new RunStopped(AgentErrorCode.TIME_LIMIT, `Run took longer than ${Math.round(maxDurationMs / 1000)}s.`)),
        maxDurationMs,
      );

      const ctx: AgentRunContext = {
        registry: deps.registry,
        userId,
        deviceId,
        runId: run.runId,
        signal,
        graceMs: deps.graceMs,
        models,
        limits,
        usage: { toolCalls: 0 },
        emit,
        onProgress: (toolCallId, p) => emit({ type: "progress", toolCallId, ...p }),
      };

      emit({ type: "run", runId: run.runId });
      console.log(`[BigFish] run ${run.runId} started on ${deviceId}`);
      try {
        const answer = await runAgent(ctx, prompt);
        emit({ type: "final", answer });
        console.log(`[BigFish] run ${run.runId} finished (${ctx.usage.toolCalls} tool calls)`);
      } catch (err) {
        const event = errorEvent(err, signal);
        emit(event);
        const detail = event.code === AgentErrorCode.AGENT_FAILED ? String(err instanceof Error ? err.message : err) : event.message;
        console.warn(`[BigFish] run ${run.runId} ended: ${event.code} ${detail}`);
      } finally {
        clearTimeout(timer);
        clearInterval(heartbeat);
        deps.runs.finish(run);
        await writes;
      }
    });
  }

  async function cancel(c: Context<UserEnv>) {
    const body = await c.req.json().catch(() => null);
    const runId = typeof body?.runId === "string" ? body.runId : "";
    if (!deps.runs.cancel(c.get("userId"), runId)) {
      return c.json({ ok: false, code: ApiErrorCode.NOT_FOUND, message: "No such run for this account." }, 404);
    }
    return c.json({ ok: true });
  }

  return { invoke, cancel };
}

function errorEvent(err: unknown, signal: AbortSignal): Extract<AgentEvent, { type: "error" }> {
  const reason = signal.aborted ? signal.reason : err;
  if (reason instanceof RunStopped) return { type: "error", code: reason.code, message: reason.message };
  if (err instanceof ToolLimitError) return { type: "error", code: AgentErrorCode.TOOL_LIMIT, message: err.message };
  // Provider errors can carry a whole response body. The UI gets the first
  // line only; the server log keeps the full error.
  const raw = err instanceof Error ? err.message : String(err);
  const message = (raw.split("\n")[0] ?? "").slice(0, ERROR_MESSAGE_LIMIT) || "The agent failed.";
  return { type: "error", code: AgentErrorCode.AGENT_FAILED, message };
}
