// Dev-only routes for checking the MCP pipe by hand. Mounted only when
// ENABLE_DEV_ROUTES=1. Removed once the agent routes exist.
import { Hono } from "hono";
import { ErrorCode } from "@bigfish/contracts";
import { issueUserJwt } from "../auth/jwt.js";
import type { SessionRegistry } from "../mcp/registry.js";
import { SessionError } from "../mcp/session.js";

// The fake extension logs in as this user, without Google.
export const DEV_USER_ID = "dev";

export function devRoutes(registry: SessionRegistry, jwtSecret: Uint8Array) {
  const routes = new Hono();

  routes.post("/login", async (c) => {
    const { token, expiresAt } = await issueUserJwt(jwtSecret, { userId: DEV_USER_ID, email: "dev@localhost" });
    return c.json({ ok: true, token, expiresAt, email: "dev@localhost" });
  });

  // All users' devices, with what the extension's MCP server reported during init.
  routes.get("/devices", (c) =>
    c.json(
      registry.all().map((s) => ({
        ...s.info,
        state: s.state,
        connectedAt: new Date(s.connectedAt).toISOString(),
        mcp: {
          server: s.client.getServerVersion(),
          protocolVersion: s.client.getNegotiatedProtocolVersion(),
          era: s.client.getProtocolEra(),
          capabilities: s.client.getServerCapabilities(),
          instructions: s.client.getInstructions(),
        },
        tools: s.tools.map((t) => ({ name: t.name, annotations: t.annotations })),
      })),
    ),
  );

  // Call any allowlisted tool on any user's device. Body = tool arguments.
  routes.post("/devices/:deviceId/tools/:name", async (c) => {
    const session = registry.all().find((s) => s.info.deviceId === c.req.param("deviceId") && s.state === "ready");
    if (!session) return c.json({ ok: false, code: ErrorCode.NOT_CONNECTED }, 404);
    const args = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    try {
      const result = await session.callTool(c.req.param("name"), args, { timeoutMs: 30_000 });
      return c.json({ ok: !result.isError, content: result.content });
    } catch (err) {
      const code = err instanceof SessionError ? err.code : ErrorCode.TIMEOUT;
      return c.json({ ok: false, code, message: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  routes.get("/devices/:deviceId/ping", async (c) => {
    const session = registry.get(DEV_USER_ID, c.req.param("deviceId"));
    if (!session) return c.json({ ok: false, code: ErrorCode.NOT_CONNECTED }, 404);
    try {
      const result = await session.callTool("browser_ping", {}, { timeoutMs: 10_000 });
      return c.json({ ok: !result.isError, content: result.content });
    } catch (err) {
      const code = err instanceof SessionError ? err.code : ErrorCode.TIMEOUT;
      return c.json({ ok: false, code, message: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return routes;
}
