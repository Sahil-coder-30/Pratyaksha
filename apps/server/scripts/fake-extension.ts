// Fake BigFish extension. Speaks the same /mcp-ws protocol as the real one
// (ticket, dial out, hello, then act as the MCP server) without Chrome.
// Used by tests, and by hand: `pnpm --filter @bigfish/server fake-ext [deviceId]`
// (needs ENABLE_DEV_ROUTES=1 on the server, it logs in as the dev user).
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { TOOLS, WS_PATH, type ToolContract } from "@bigfish/contracts";
import { openMcpSocket, type OpenMcpSocketOptions } from "@bigfish/mcp-ws";

export interface FakeResult {
  text: string;
  isError?: boolean;
  // Sent as an MCP image block, like browser_screenshot.
  image?: { data: string; mimeType: string };
}

export type FakeHandler = (
  args: Record<string, unknown>,
  extra: { signal: AbortSignal },
) => Promise<string | FakeResult> | string | FakeResult;

export interface FakeExtensionOptions
  extends Partial<Pick<OpenMcpSocketOptions, "contracts" | "heartbeatIntervalMs" | "heartbeatDeadlineMs">> {
  // Full /mcp-ws URL, ticket included (see ticketUrl).
  url: string;
  // Sent as the Origin header, like Chrome does for the real extension.
  origin?: string;
  deviceId?: string;
  ext?: string;
  // Extra tools on top of the contract TOOLS (e.g. to test the server allowlist).
  extraTools?: ToolContract[];
  handlers?: Record<string, FakeHandler>;
}

const FAKE_EXT_VERSION = "0.0.0-fake";

export async function startFakeExtension(opts: FakeExtensionOptions) {
  const deviceId = opts.deviceId ?? `fake-${randomUUID()}`;
  const ext = opts.ext ?? FAKE_EXT_VERSION;
  const socket = await openMcpSocket({
    url: opts.url,
    deviceId,
    ext,
    contracts: opts.contracts,
    heartbeatIntervalMs: opts.heartbeatIntervalMs,
    heartbeatDeadlineMs: opts.heartbeatDeadlineMs,
    WebSocketImpl: opts.origin ? withOrigin(opts.origin) : undefined,
  });

  const server = new McpServer({ name: "bigfish-fake-extension", version: ext });
  for (const tool of [...TOOLS, ...(opts.extraTools ?? [])]) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: tool.annotations },
      async (args, ctx) => {
        const handler = opts.handlers?.[tool.name] ?? defaultHandler(tool.name, ext);
        const out = await handler(args as Record<string, unknown>, { signal: ctx.mcpReq.signal });
        const { text, isError, image }: FakeResult = typeof out === "string" ? { text: out, isError: false } : out;
        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [{ type: "text", text }];
        if (image) content.push({ type: "image", ...image });
        return { content, isError };
      },
    );
  }
  await server.connect(socket.transport);

  return { deviceId, socket, server, close: () => socket.close() };
}

// Logs in through the API and returns a /mcp-ws URL with a fresh ticket.
export async function ticketUrl(httpBase: string, jwt: string): Promise<string> {
  const res = await fetch(`${httpBase}/api/ws-ticket`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } });
  const body = (await res.json()) as { ok: boolean; ticket?: string; message?: string };
  if (!body.ok || !body.ticket) throw new Error(`ws-ticket failed: ${res.status} ${body.message ?? ""}`);
  return `${httpBase.replace(/^http/, "ws")}${WS_PATH}?ticket=${encodeURIComponent(body.ticket)}`;
}

// Node's WebSocket accepts headers as a second argument. Browsers set Origin themselves.
export function withOrigin(origin: string): typeof WebSocket {
  return class extends WebSocket {
    constructor(url: string | URL) {
      super(url, { headers: { origin } } as unknown as string[]);
    }
  };
}

function defaultHandler(name: string, ext: string): FakeHandler {
  if (name === "browser_ping") return () => `ok pong | ext ${ext} | fake`;
  return () => ({ text: `ERROR UNKNOWN_TOOL: ${name} is not implemented in the fake extension.`, isError: true });
}

// CLI: connect once and stay connected until the socket closes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const httpBase = process.env.BIGFISH_URL ?? "http://127.0.0.1:8787";
  const login = await fetch(`${httpBase}/api/dev/login`, { method: "POST" });
  if (!login.ok) throw new Error(`dev login failed (${login.status}). Is the server running with ENABLE_DEV_ROUTES=1?`);
  const { token } = (await login.json()) as { token: string };
  const fake = await startFakeExtension({
    url: await ticketUrl(httpBase, token),
    deviceId: process.argv[2],
    origin: process.env.BIGFISH_ORIGIN,
  });
  console.log(`[fake-ext] connected as ${fake.deviceId} (conn ${fake.socket.connId}) to ${httpBase}`);
  const closed = await fake.socket.closed;
  console.log(`[fake-ext] closed: ${closed.code} ${closed.reason}`);
  process.exit(0);
}
