// How the agent calls a browser tool through the device session:
// - Device missing (e.g. service worker restarting): wait up to a grace window.
// - Connection lost mid-call: read-only tools retry once after reconnect;
//   mutating tools never retry and return STATE_UNKNOWN, so no click runs twice.
// - Results go to the model as untrusted page data, errors as ERROR lines.
import { ErrorCode, TOOLS, toolError } from "@bigfish/contracts";
import type { CallToolResult } from "@modelcontextprotocol/client";
import type { SessionRegistry } from "../mcp/registry.js";
import { SessionError, type DeviceSession } from "../mcp/session.js";

export const RECONNECT_GRACE_MS = 15_000;

const READ_ONLY: ReadonlySet<string> = new Set(
  TOOLS.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name),
);

export interface ToolCallContext {
  registry: SessionRegistry;
  userId: string;
  deviceId: string;
  runId: string;
  signal: AbortSignal;
  graceMs?: number;
  onProgress?: (toolCallId: string, progress: { progress: number; total?: number; message?: string }) => void;
}

export interface BrowserToolResult {
  ok: boolean;
  // What the model sees.
  text: string;
  // A masked screenshot (browser_screenshot). The extension already replaced private data with tokens.
  image?: { data: string; mimeType: string };
}

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY.has(name);
}

export async function callBrowserTool(
  ctx: ToolCallContext,
  name: string,
  args: Record<string, unknown>,
  toolCallId: string,
): Promise<BrowserToolResult> {
  const readOnly = isReadOnlyTool(name);
  let retried = false;

  for (;;) {
    const session = await ctx.registry.waitFor(ctx.userId, ctx.deviceId, ctx.graceMs ?? RECONNECT_GRACE_MS, ctx.signal);
    ctx.signal.throwIfAborted();
    if (!session) {
      return fail(ErrorCode.NOT_CONNECTED, "The browser extension is not connected.", "Stop and tell the user to open Chrome with BigFish signed in.");
    }

    try {
      const result = await session.callTool(name, args, {
        runId: ctx.runId,
        toolCallId,
        signal: ctx.signal,
        onProgress: ctx.onProgress && ((p) => ctx.onProgress!(toolCallId, p)),
      });
      return toResult(result);
    } catch (err) {
      ctx.signal.throwIfAborted();
      // Closed before our turn in the queue: nothing reached the browser, safe to wait and retry.
      if (err instanceof SessionError && err.code === ErrorCode.NOT_CONNECTED && !retried) {
        retried = true;
        continue;
      }
      if (err instanceof SessionError) return fail(err.code as ErrorCode, err.message);
      if (!connectionLost(session)) {
        return fail(
          ErrorCode.TIMEOUT,
          `${name} did not answer in time.`,
          readOnly ? "Try once more." : "The action may or may not have happened. Re-snapshot before acting.",
        );
      }
      if (!readOnly) {
        return fail(ErrorCode.STATE_UNKNOWN, `Connection lost during ${name}.`, "Re-snapshot before acting.");
      }
      if (retried) return fail(ErrorCode.NOT_CONNECTED, `Connection lost during ${name}, twice.`);
      retried = true;
    }
  }
}

function connectionLost(session: DeviceSession): boolean {
  return session.state === "closed";
}

function toResult(result: CallToolResult): BrowserToolResult {
  const text = result.content
    .filter((block) => block.type !== "image")
    .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
    .join("\n");
  if (result.isError) return { ok: false, text };
  const image = result.content.find((block) => block.type === "image");
  // Page content is data for the model, never instructions.
  return {
    ok: true,
    text: `<page untrusted>\n${text}\n</page>`,
    ...(image?.type === "image" ? { image: { data: image.data, mimeType: image.mimeType } } : {}),
  };
}

function fail(code: ErrorCode, message: string, hint?: string): BrowserToolResult {
  return { ok: false, text: toolError(code, message, hint) };
}
