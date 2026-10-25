// GET /api/devices: the signed-in user's connected browsers.
// POST /api/devices/:deviceId/ping: browser_ping on one of them, end to end.
import { Hono } from "hono";
import { ErrorCode } from "@bigfish/contracts";
import { requireUser, type UserEnv } from "../auth/middleware.js";
import type { SessionRegistry } from "../mcp/registry.js";
import { SessionError } from "../mcp/session.js";

export function devicesRoutes(registry: SessionRegistry, jwtSecret: Uint8Array) {
  const routes = new Hono<UserEnv>();
  routes.use("/devices", requireUser(jwtSecret));
  routes.use("/devices/*", requireUser(jwtSecret));

  routes.get("/devices", (c) =>
    c.json({
      ok: true,
      devices: registry.listForUser(c.get("userId")).map((s) => ({
        deviceId: s.info.deviceId,
        ext: s.info.ext,
        state: s.state,
        connectedAt: new Date(s.connectedAt).toISOString(),
        tools: s.tools.map((t) => t.name),
      })),
    }),
  );

  // Looked up under the JWT user, so another user's device is simply not found.
  routes.post("/devices/:deviceId/ping", async (c) => {
    const session = registry.get(c.get("userId"), c.req.param("deviceId"));
    if (!session) return c.json({ ok: false, code: ErrorCode.NOT_CONNECTED, message: "Device not connected." }, 404);
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
