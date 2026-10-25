// BigFish agent: the tool loop for one subtask. Fresh messages per subtask,
// one browser action per turn, loop guard, tool call limits, and old page
// results cleared so the context stays small.
import { ErrorCode, TOOLS, toolError, type AgentEvent } from "@bigfish/contracts";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { AgentModels } from "./models.js";
import { LoopGuard } from "./loop-guard.js";
import { allowsMadeUpValues, checkPersonalValues } from "./personal-guard.js";
import { ACTOR_PROMPT } from "./prompts.js";
import { callBrowserTool, isReadOnlyTool, type ToolCallContext } from "./tool-policy.js";
import { agentToolDefs, isControlTool, parseToolArgs } from "./tools.js";

export interface AgentLimits {
  maxToolCalls: number;
  maxSubtaskToolCalls: number;
}

export interface AgentRunContext extends ToolCallContext {
  models: AgentModels;
  emit(event: AgentEvent): void;
  limits: AgentLimits;
  // Browser tool calls so far in this run, across subtasks.
  usage: { toolCalls: number };
  // Browser result texts so far in this run, for the personal details guard.
  seen?: string[];
}

export class ToolLimitError extends Error {}

export interface SubtaskInput {
  // The user's whole task, so links and values the planner left out still reach the actor.
  task: string;
  goal: string;
  criteria: string;
  feedback?: string;
  notes: Record<string, string>;
  tabs: string;
}

export interface SubtaskOutcome {
  status: "done" | "failed";
  result: string;
  notes: Record<string, string>;
  // The last browser results, so the verifier can check facts that are not on the page (e.g. the tab list).
  observations: string[];
}

// Browser results older than the last few are replaced with a stub.
const KEEP_FULL_RESULTS = 3;
// Times we remind a model that answered in text instead of calling a tool.
const MAX_NUDGES = 2;
const EVENT_TEXT_LIMIT = 1_500;
// Enough to cover fill, submit, wait and snapshot, so the verifier sees the fill too.
const OBSERVATIONS_KEPT = 6;
const OBSERVATION_CHARS = 1_000;

export async function runSubtask(ctx: AgentRunContext, subtaskId: number, input: SubtaskInput): Promise<SubtaskOutcome> {
  const session = ctx.registry.get(ctx.userId, ctx.deviceId);
  const deviceTools = new Set(session?.tools.map((t) => t.name) ?? TOOLS.map((t) => t.name));
  if (ctx.models.vision === false) deviceTools.delete("browser_screenshot");
  const model = ctx.models.act(agentToolDefs(deviceTools));
  const guard = new LoopGuard();
  const notes = { ...input.notes };
  const observations: string[] = [];
  const seen = (ctx.seen ??= []);
  const end = (outcome: Pick<SubtaskOutcome, "status" | "result">): SubtaskOutcome => ({
    ...outcome,
    notes,
    observations: observations.slice(-OBSERVATIONS_KEPT),
  });
  const messages: BaseMessage[] = [new SystemMessage(ACTOR_PROMPT), new HumanMessage(subtaskBrief(input))];
  let subtaskCalls = 0;
  let nudges = 0;

  for (;;) {
    ctx.signal.throwIfAborted();
    let reply: AIMessage;
    try {
      reply = await model.invoke(clearOldResults(messages), { signal: ctx.signal });
    } catch (err) {
      // A reply cut at the token limit (long reasoning) is not fatal: ask for a short one, a few times.
      if (!/length limit/i.test(err instanceof Error ? err.message : String(err)) || nudges++ >= MAX_NUDGES) throw err;
      messages.push(new HumanMessage("Your last reply was cut off because it was too long. Think briefly, then call one tool."));
      continue;
    }
    const calls = reply.tool_calls ?? [];
    // Mistral rejects an assistant message with no text and no tool calls,
    // so an empty reply is dropped instead of kept in the history.
    if (calls.length > 0 || textOf(reply).trim()) messages.push(reply);

    if (calls.length === 0) {
      if (nudges++ >= MAX_NUDGES) {
        return end({ status: "failed", result: `Stopped without finishing: ${textOf(reply).slice(0, 300)}` });
      }
      messages.push(new HumanMessage("Call a tool. When the criteria are met, call complete_subtask. If it cannot be done, call fail_subtask."));
      continue;
    }

    let outcome: Pick<SubtaskOutcome, "status" | "result"> | null = null;
    let acted = false;
    // Screenshots go in after every tool answer: a user message between tool answers is rejected.
    const screenshots: HumanMessage[] = [];
    for (const call of calls) {
      const id = call.id ?? `call_${messages.length}`;
      const answer = (content: string) => messages.push(new ToolMessage({ content, tool_call_id: id, name: call.name }));

      if (outcome) {
        answer("SKIPPED: the subtask already ended.");
        continue;
      }
      if (acted) {
        answer("SKIPPED: one browser action per turn. Check the last result, then call this again if still needed.");
        continue;
      }
      const parsed = parseToolArgs(call.name, call.args);
      if (!parsed.ok) {
        answer(toolError(ErrorCode.INVALID_ARGS, parsed.error));
        continue;
      }
      const args = parsed.args;

      if (isControlTool(call.name)) {
        if (call.name === "save_fact") {
          notes[String(args.key)] = String(args.value);
          ctx.emit({ type: "step", node: "act", subtask: subtaskId, message: `Saved ${String(args.key)}` });
          answer("ok saved");
        } else if (call.name === "complete_subtask") {
          outcome = { status: "done", result: `${String(args.summary)} (evidence: ${String(args.evidence)})` };
          answer("ok");
        } else {
          outcome = { status: "failed", result: String(args.reason) };
          answer("ok");
        }
        continue;
      }

      const looped = guard.check(call.name, args);
      if (looped) {
        answer(looped);
        continue;
      }
      const blocked = checkPersonalValues(call.name, args, { task: input.task, results: seen });
      if (blocked) {
        answer(blocked);
        continue;
      }
      if (ctx.usage.toolCalls >= ctx.limits.maxToolCalls) {
        throw new ToolLimitError(`Run used its ${ctx.limits.maxToolCalls} browser tool calls.`);
      }
      if (subtaskCalls >= ctx.limits.maxSubtaskToolCalls) {
        return end({ status: "failed", result: `Used ${subtaskCalls} tool calls without finishing.` });
      }
      ctx.usage.toolCalls++;
      subtaskCalls++;

      ctx.emit({ type: "tool_call", toolCallId: id, name: call.name, args });
      const result = await callBrowserTool(ctx, call.name, args, id);
      ctx.emit({ type: "tool_result", toolCallId: id, name: call.name, ok: result.ok, text: result.text.slice(0, EVENT_TEXT_LIMIT) });
      answer(result.text);
      if (result.image) screenshots.push(screenshotMessage(result.image));
      seen.push(result.text);
      guard.record(call.name, args, result.ok);
      observations.push(`${call.name}: ${result.text.slice(0, OBSERVATION_CHARS)}`);
      if (!isReadOnlyTool(call.name)) acted = true;
    }

    messages.push(...screenshots);
    if (outcome) return end(outcome);
  }
}

// OpenAI-compatible APIs take images only in user messages, not in tool answers.
function screenshotMessage(image: { data: string; mimeType: string }): HumanMessage {
  return new HumanMessage({
    content: [
      { type: "text", text: "<page untrusted>\nThe browser_screenshot image. Labels like [NAME_1A2B] are private data hidden by BigFish.\n</page>" },
      { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
    ],
  });
}

function isScreenshot(message: BaseMessage): boolean {
  return HumanMessage.isInstance(message) && Array.isArray(message.content) && message.content.some((block) => block.type === "image_url");
}

export const MADE_UP_NOTE =
  "The user asked for made-up values. For every field or input the user gave no value for, make up a realistic sample value (e.g. Rahul Sharma, rahul.sharma@example.com). Do not ask for real details.";

function subtaskBrief(input: SubtaskInput): string {
  const notes = Object.entries(input.notes);
  return [
    `User task (context for links and values; do only the subtask below):\n${input.task}`,
    `Subtask goal: ${input.goal}`,
    `Done when: ${input.criteria}`,
    allowsMadeUpValues(input.task) ? MADE_UP_NOTE : "",
    input.feedback ? `Previous attempt was not accepted: ${input.feedback}` : "",
    notes.length ? `Facts saved so far:\n${notes.map(([k, v]) => `- ${k}: ${v}`).join("\n")}` : "",
    `Open tabs:\n${input.tabs}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Keeps the last KEEP_FULL_RESULTS browser results. Older ones become a stub,
// since the page has changed since then anyway. The last snapshot is kept too:
// it is the ref list the model is still acting on. Only the newest screenshot
// is kept, since each one costs many tokens.
function clearOldResults(messages: BaseMessage[]): BaseMessage[] {
  const browserResults = messages.filter((m) => ToolMessage.isInstance(m) && m.name && !isControlTool(m.name));
  const stale = new Set(browserResults.slice(0, -KEEP_FULL_RESULTS));
  const lastSnapshot = browserResults.findLast((m) => ToolMessage.isInstance(m) && m.name === "browser_snapshot");
  if (lastSnapshot) stale.delete(lastSnapshot);
  const screenshots = messages.filter(isScreenshot);
  for (const old of screenshots.slice(0, -1)) stale.add(old);
  if (stale.size === 0) return messages;
  return messages.map((m) => {
    if (!stale.has(m)) return m;
    if (ToolMessage.isInstance(m)) {
      return new ToolMessage({ content: "[old result cleared; values you saved with save_fact are kept]", tool_call_id: m.tool_call_id, name: m.name });
    }
    return new HumanMessage("[old screenshot cleared]");
  });
}

function textOf(message: AIMessage): string {
  return typeof message.content === "string" ? message.content : message.text;
}
