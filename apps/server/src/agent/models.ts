// BigFish agent: models. The graph only sees the AgentModels interface, so
// tests can script every model answer. The real one is NVIDIA, OpenRouter or Mistral.
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { FINALIZE_PROMPT, JUDGE_PROMPT, PLANNER_PROMPT } from "./prompts.js";

export const PlanSchema = z.object({
  subtasks: z
    .array(
      z.object({
        goal: z.string().describe("One concrete thing to do in the browser."),
        criteria: z.string().describe("What must be visible on the page, or known, when the goal is met."),
      }),
    )
    .min(1)
    .max(6),
});
export type PlanOutput = z.infer<typeof PlanSchema>;

export const VerdictSchema = z.object({
  passed: z.boolean(),
  reason: z.string(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export interface ActModel {
  invoke(messages: BaseMessage[], options: { signal: AbortSignal }): Promise<AIMessage>;
}

export interface AgentModels {
  plan(input: { task: string; tabs: string }, signal: AbortSignal): Promise<PlanOutput>;
  // A model with these tools bound, used for the tool loop of one subtask.
  act(tools: StructuredToolInterface[]): ActModel;
  judge(input: string, signal: AbortSignal): Promise<Verdict>;
  finalize(input: string, signal: AbortSignal): Promise<string>;
  // false hides browser_screenshot, for a model that cannot read images.
  vision?: boolean;
}

export interface ModelConfig {
  provider: "nvidia" | "openrouter" | "mistral";
  apiKey: string;
  model: string;
  judgeModel: string;
  vision: boolean;
}

// OpenAI-compatible endpoints.
const BASE_URLS = { nvidia: "https://integrate.api.nvidia.com/v1", openrouter: "https://openrouter.ai/api/v1" } as const;
// 429s are retried with backoff (about 1, 2, 4 ... 32s), enough to ride out a per-minute limit.
const MAX_RETRIES = 6;
// Without a cap, OpenRouter reserves the model's maximum and answers 402 when the
// balance is low. NVIDIA's reasoning models think at length, so they get more room.
const MAX_TOKENS = { nvidia: 16_384, openrouter: 4_096 } as const;
// A stuck provider request is cut and retried instead of hanging the run.
const CALL_TIMEOUT_MS = 90_000;

const isSet = (value: string | undefined): value is string => !!value && value !== "REPLACE_ME";

// The first provider with a key wins: NVIDIA, then OpenRouter, then Mistral.
// Undefined when no key is set: the agent routes answer 503.
export function modelConfigFromEnv(env: NodeJS.ProcessEnv): ModelConfig | undefined {
  const config = providerFromEnv(env);
  // The default models read images. AGENT_VISION=false is for a text-only model.
  return config && { ...config, vision: env.AGENT_VISION !== "false" };
}

function providerFromEnv(env: NodeJS.ProcessEnv): Omit<ModelConfig, "vision"> | undefined {
  if (isSet(env.NVIDIA_API_KEY)) {
    return {
      provider: "nvidia",
      apiKey: env.NVIDIA_API_KEY,
      model: env.NVIDIA_MODEL || "nvidia/nemotron-3.5-super-vl-120b-a12b",
      judgeModel: env.NVIDIA_JUDGE_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b",
    };
  }
  if (isSet(env.OPEN_ROUTER_API_KEY)) {
    const model = env.OPEN_ROUTER_MODEL || "openai/gpt-6-luna";
    return { provider: "openrouter", apiKey: env.OPEN_ROUTER_API_KEY, model, judgeModel: env.OPEN_ROUTER_JUDGE_MODEL || model };
  }
  if (isSet(env.MISTRAL_API_KEY)) {
    return {
      provider: "mistral",
      apiKey: env.MISTRAL_API_KEY,
      model: env.AGENT_MODEL || "mistral-medium-latest",
      judgeModel: env.AGENT_JUDGE_MODEL || "mistral-small-latest",
    };
  }
  return undefined;
}

// Both clients support tool calling, so bindTools is always there.
function chatModel(config: ModelConfig, model: string): BaseChatModel & Required<Pick<BaseChatModel, "bindTools">> {
  if (config.provider === "mistral") {
    return new ChatMistralAI({ apiKey: config.apiKey, model, temperature: 0, maxRetries: MAX_RETRIES });
  }
  return new ChatOpenAI({
    apiKey: config.apiKey,
    model,
    temperature: 0,
    maxTokens: MAX_TOKENS[config.provider],
    maxRetries: MAX_RETRIES,
    timeout: CALL_TIMEOUT_MS,
    configuration: { baseURL: BASE_URLS[config.provider] },
  });
}

export function agentModels(config: ModelConfig): AgentModels {
  const main = chatModel(config, config.model);
  const cheap = chatModel(config, config.judgeModel);
  const planner = main.withStructuredOutput(PlanSchema, { name: "plan" });
  const judge = cheap.withStructuredOutput(VerdictSchema, { name: "verdict" });

  return {
    plan: ({ task, tabs }, signal) =>
      planner.invoke([new SystemMessage(PLANNER_PROMPT), new HumanMessage(`Open tabs:\n${tabs}\n\nTask:\n${task}`)], { signal }),
    act: (tools) => {
      const bound = main.bindTools(tools);
      return { invoke: (messages, { signal }) => bound.invoke(messages, { signal }) };
    },
    judge: (input, signal) => judge.invoke([new SystemMessage(JUDGE_PROMPT), new HumanMessage(input)], { signal }),
    vision: config.vision,
    finalize: async (input, signal) => {
      const reply = await main.invoke([new SystemMessage(FINALIZE_PROMPT), new HumanMessage(input)], { signal });
      return typeof reply.content === "string" ? reply.content : reply.text;
    },
  };
}
