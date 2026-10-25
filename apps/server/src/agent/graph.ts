// BigFish agent: the run graph.
//   plan -> act -> verify -> (act again with feedback | next subtask | finalize)
// State holds the subtasks and saved facts, never a growing chat history.
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { MADE_UP_NOTE, runSubtask, type AgentRunContext } from "./actor.js";
import { allowsMadeUpValues } from "./personal-guard.js";
import { callBrowserTool } from "./tool-policy.js";

export interface Subtask {
  id: number;
  goal: string;
  criteria: string;
  status: "pending" | "done" | "failed" | "verified";
  attempts: number;
  result?: string;
  feedback?: string;
  observations?: string[];
  // The agent's report from each attempt, so a retry and the final answer know
  // what an earlier attempt already did (e.g. a form it submitted).
  reports?: string[];
}

// Tries per subtask, including the first one.
const MAX_ATTEMPTS = 2;
const VERIFY_SNAPSHOT_CHARS = 2_000;

const AgentState = Annotation.Root({
  task: Annotation<string>,
  tabs: Annotation<string>,
  subtasks: Annotation<Subtask[]>({ reducer: (_old, next) => next, default: () => [] }),
  current: Annotation<number>({ reducer: (_old, next) => next, default: () => 0 }),
  notes: Annotation<Record<string, string>>({ reducer: (_old, next) => next, default: () => ({}) }),
  final: Annotation<string>({ reducer: (_old, next) => next, default: () => "" }),
});
type State = typeof AgentState.State;

export async function runAgent(ctx: AgentRunContext, task: string): Promise<string> {
  const graph = buildGraph(ctx);
  const result = await graph.invoke({ task }, { signal: ctx.signal, recursionLimit: 60 });
  return result.final;
}

function buildGraph(ctx: AgentRunContext) {
  return new StateGraph(AgentState)
    .addNode("plan", (state) => planNode(ctx, state))
    .addNode("act", (state) => actNode(ctx, state))
    .addNode("verify", (state) => verifyNode(ctx, state))
    .addNode("finalize", (state) => finalizeNode(ctx, state))
    .addEdge(START, "plan")
    .addEdge("plan", "act")
    .addEdge("act", "verify")
    .addConditionalEdges("verify", (state) => {
      const subtask = state.subtasks[state.current];
      if (subtask?.status === "pending") return "act";
      return "finalize";
    })
    .addEdge("finalize", END)
    .compile();
}

async function planNode(ctx: AgentRunContext, state: State): Promise<Partial<State>> {
  ctx.emit({ type: "step", node: "plan", message: "Planning" });
  const tabs = await listTabs(ctx);
  const { subtasks } = await ctx.models.plan({ task: state.task, tabs }, ctx.signal);
  const plan: Subtask[] = subtasks.map((s, i) => ({ id: i + 1, goal: s.goal, criteria: s.criteria, status: "pending", attempts: 0 }));
  ctx.emit({ type: "plan", subtasks: plan.map(({ id, goal, criteria }) => ({ id, goal, criteria })) });
  return { subtasks: plan, tabs, current: 0 };
}

async function actNode(ctx: AgentRunContext, state: State): Promise<Partial<State>> {
  const subtask = state.subtasks[state.current]!;
  ctx.emit({
    type: "step",
    node: "act",
    subtask: subtask.id,
    message: subtask.attempts > 0 ? `Retrying: ${subtask.goal}` : subtask.goal,
  });
  // Tabs may have changed since planning or the last subtask.
  const tabs = state.current === 0 && subtask.attempts === 0 ? state.tabs : await listTabs(ctx);
  const outcome = await runSubtask(ctx, subtask.id, {
    task: state.task,
    goal: subtask.goal,
    criteria: subtask.criteria,
    feedback: subtask.feedback,
    notes: state.notes,
    tabs,
  });
  const updated: Subtask = {
    ...subtask,
    status: outcome.status,
    result: outcome.result,
    observations: outcome.observations,
    reports: [...(subtask.reports ?? []), outcome.result],
    attempts: subtask.attempts + 1,
  };
  return { subtasks: replaceAt(state.subtasks, state.current, updated), notes: outcome.notes };
}

async function verifyNode(ctx: AgentRunContext, state: State): Promise<Partial<State>> {
  const subtask = state.subtasks[state.current]!;
  let passed = false;
  let reason = subtask.result ?? "";

  if (subtask.status === "done") {
    const page = await verifyPageText(ctx, `verify_${subtask.id}_${subtask.attempts}`);
    const verdict = await ctx.models.judge(
      [
        `User task: ${state.task}`,
        allowsMadeUpValues(state.task) ? MADE_UP_NOTE : "",
        `Goal: ${subtask.goal}`,
        `Criteria: ${subtask.criteria}`,
        `Agent report: ${subtask.result ?? ""}`,
        `Saved facts:\n${formatNotes(state.notes) || "(none)"}`,
        `Last tool results the agent saw:\n${subtask.observations?.join("\n\n") || "(none)"}`,
        `Current page:\n${page}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      ctx.signal,
    );
    passed = verdict.passed;
    reason = verdict.reason;
  }
  ctx.emit({ type: "step", node: "verify", subtask: subtask.id, message: `${passed ? "Passed" : "Not done"}: ${reason}` });

  if (passed) {
    const subtasks = replaceAt(state.subtasks, state.current, { ...subtask, status: "verified" });
    const next = state.current + 1;
    // Past the last subtask, the router goes to finalize.
    return { subtasks, current: next < subtasks.length ? next : state.current };
  }
  if (subtask.attempts < MAX_ATTEMPTS) {
    const feedback = subtask.result && subtask.result !== reason ? `${reason}\nYour report from that attempt: ${subtask.result}` : reason;
    return { subtasks: replaceAt(state.subtasks, state.current, { ...subtask, status: "pending", feedback }) };
  }
  // Out of attempts: later subtasks may depend on this one, so stop here.
  return { subtasks: replaceAt(state.subtasks, state.current, { ...subtask, status: "failed", result: reason }) };
}

async function finalizeNode(ctx: AgentRunContext, state: State): Promise<Partial<State>> {
  ctx.emit({ type: "step", node: "finalize", message: "Writing the answer" });
  const subtasks = state.subtasks
    .map((s) => {
      const line = `${s.id}. [${s.status === "verified" ? "done" : s.status}] ${s.goal}${s.result ? ` -> ${s.result}` : ""}`;
      const reports = (s.reports ?? []).map((r, i) => `   attempt ${i + 1} report: ${r}`);
      return [line, ...reports].join("\n");
    })
    .join("\n");
  const notes = formatNotes(state.notes);
  const final = await ctx.models.finalize(
    `User task:\n${state.task}\n\nSubtasks:\n${subtasks}\n\nSaved facts:\n${notes || "(none)"}`,
    ctx.signal,
  );
  return { final };
}

// The top of the page (headings, a form's state) and, when the page is long,
// its end too (a chat reply, a confirmation below the fold).
async function verifyPageText(ctx: AgentRunContext, id: string): Promise<string> {
  const top = await callBrowserTool(ctx, "browser_snapshot", { mode: "text", max_chars: VERIFY_SNAPSHOT_CHARS }, `${id}_top`);
  if (!top.ok || !top.text.includes(" more chars (offset=")) return top.text;
  const end = await callBrowserTool(ctx, "browser_snapshot", { mode: "text", max_chars: VERIFY_SNAPSHOT_CHARS, from_end: true }, `${id}_end`);
  return `${top.text}\n\nEnd of the page:\n${end.text}`;
}

async function listTabs(ctx: AgentRunContext): Promise<string> {
  const result = await callBrowserTool(ctx, "browser_tabs", { action: "list" }, `tabs_${Date.now()}`);
  return result.text;
}

function formatNotes(notes: Record<string, string>): string {
  return Object.entries(notes)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
}

function replaceAt(plan: Subtask[], index: number, subtask: Subtask): Subtask[] {
  return plan.map((existing, i) => (i === index ? subtask : existing));
}
