// Side panel side of the agent API: POST /api/agent/invoke, read its SSE
// stream, and cancel. The service worker hands over the JWT and device ID.
import type { AgentEvent } from "@bigfish/contracts";

export interface AgentRun {
  // Resolves when the stream ends (final, error, or cancel).
  done: Promise<void>;
  cancel(): Promise<void>;
}

interface AgentContext {
  ok: boolean;
  error?: string;
  token: string;
  deviceId: string;
  serverUrl: string;
}

export async function startAgentRun(prompt: string, onEvent: (event: AgentEvent) => void): Promise<AgentRun> {
  const ctx = (await browser.runtime.sendMessage({ type: "BIGFISH_AGENT_CONTEXT" })) as AgentContext;
  if (!ctx?.ok) throw new Error(ctx?.error ?? "Sign in first.");

  const reading = new AbortController();
  const res = await fetch(`${ctx.serverUrl}/api/agent/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ctx.token}` },
    body: JSON.stringify({ deviceId: ctx.deviceId, prompt }),
    signal: reading.signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `The server answered ${res.status}.`);
  }

  let runId = "";
  const done = readSse(res.body, (event) => {
    if (event.type === "run") runId = event.runId;
    onEvent(event);
  }).catch((err) => {
    if (!reading.signal.aborted) throw err;
  });

  return {
    done,
    async cancel() {
      if (!runId) return reading.abort();
      await fetch(`${ctx.serverUrl}/api/agent/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ctx.token}` },
        body: JSON.stringify({ runId }),
      }).catch(() => reading.abort());
    },
  };
}

// Minimal SSE parser: blocks split by a blank line, JSON in the data lines.
async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: AgentEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as AgentEvent);
    }
  }
}
