// BigFish agent: tools the model can call. Browser tools come from the contracts
// (filtered to what the device reported). Control tools end or feed a subtask.
// The actor loop runs every call itself, so these are definitions only.
import { TOOLS, normalizeToolArgs } from "@bigfish/contracts";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

export const CONTROL_TOOLS = {
  save_fact: {
    description: "Save a fact the user asked for, as soon as you find it. Saved facts are used for the final answer.",
    schema: z.object({ key: z.string().describe("Short name, e.g. pro_price"), value: z.string() }),
  },
  complete_subtask: {
    description: "Finish the current subtask when its criteria are met.",
    schema: z.object({
      summary: z.string().describe("What was done or found."),
      evidence: z.string().describe("What on the page shows it is done."),
    }),
  },
  fail_subtask: {
    description: "Give up on the current subtask when it cannot be done.",
    schema: z.object({ reason: z.string() }),
  },
} as const;

export type ControlToolName = keyof typeof CONTROL_TOOLS;

const SCHEMAS: Record<string, z.ZodType> = {
  ...Object.fromEntries(TOOLS.map((t) => [t.name, t.input])),
  ...Object.fromEntries(Object.entries(CONTROL_TOOLS).map(([name, t]) => [name, t.schema])),
};

export function isControlTool(name: string): name is ControlToolName {
  return name in CONTROL_TOOLS;
}

export function agentToolDefs(deviceTools: ReadonlySet<string>): StructuredToolInterface[] {
  const notRunHere = async (): Promise<string> => {
    throw new Error("Agent tools are run by the actor loop.");
  };
  const browser = TOOLS.filter((t) => deviceTools.has(t.name)).map((t) =>
    tool(notRunHere, { name: t.name, description: t.description, schema: t.input }),
  );
  const control = Object.entries(CONTROL_TOOLS).map(([name, t]) =>
    tool(notRunHere, { name, description: t.description, schema: t.schema }),
  );
  return [...browser, ...control];
}

// Checks model-made arguments against the contract before anything runs.
export function parseToolArgs(
  name: string,
  args: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const schema = SCHEMAS[name];
  if (!schema) return { ok: false, error: `Unknown tool ${name}.` };
  const raw = (args ?? {}) as Record<string, unknown>;
  const parsed = schema.safeParse(isControlTool(name) ? raw : normalizeToolArgs(name, raw));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
    return { ok: false, error: issues };
  }
  return { ok: true, args: parsed.data as Record<string, unknown> };
}
