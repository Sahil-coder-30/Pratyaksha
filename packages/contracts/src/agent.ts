// Agent run API shared by the server and the side panel.
// POST /api/agent/invoke streams these as SSE: `event: <type>`, `data: <json>`.

export interface PlannedSubtask {
  id: number;
  goal: string;
  criteria: string;
}

export type AgentEvent =
  | { type: "run"; runId: string }
  | { type: "plan"; subtasks: PlannedSubtask[] }
  | { type: "step"; node: "plan" | "act" | "verify" | "finalize"; subtask?: number; message: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: "progress"; toolCallId: string; progress: number; total?: number; message?: string }
  | { type: "tool_result"; toolCallId: string; name: string; ok: boolean; text: string }
  | { type: "final"; answer: string }
  | { type: "error"; code: AgentErrorCode; message: string };

// Why a run ended without a final answer.
export const AgentErrorCode = {
  CANCELLED: "CANCELLED",
  TIME_LIMIT: "TIME_LIMIT",
  TOOL_LIMIT: "TOOL_LIMIT",
  AGENT_FAILED: "AGENT_FAILED",
} as const;
export type AgentErrorCode = (typeof AgentErrorCode)[keyof typeof AgentErrorCode];

export const RUN_LIMITS = {
  maxToolCalls: 80,
  maxDurationMs: 8 * 60_000,
  maxPromptChars: 4_000,
} as const;
