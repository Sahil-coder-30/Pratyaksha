// POST /api/auth/google: Google access token -> BigFish JWT.
// POST /api/ws-ticket: BigFish JWT -> one-time ticket for /mcp-ws.
import { Hono } from "hono";
import { ApiErrorCode } from "@bigfish/contracts";
import type { AuthConfig } from "../auth/config.js";
import { GoogleTokenError } from "../auth/google.js";
import { issueUserJwt } from "../auth/jwt.js";
import { requireUser, type UserEnv } from "../auth/middleware.js";
import type { TicketStore } from "../auth/tickets.js";

export function authRoutes(auth: AuthConfig, tickets: TicketStore) {
  const routes = new Hono<UserEnv>();

  routes.post("/auth/google", async (c) => {
    const verify = auth.verifyGoogleToken;
    if (!verify) {
      return c.json({ ok: false, code: ApiErrorCode.AUTH_NOT_CONFIGURED, message: "Google login is not configured." }, 503);
    }
    const body = await c.req.json().catch(() => null);
    const accessToken = typeof body?.accessToken === "string" ? body.accessToken : "";
    if (!accessToken) {
      return c.json({ ok: false, code: ApiErrorCode.BAD_REQUEST, message: "accessToken is required." }, 400);
    }

    try {
      const google = await verify(accessToken);
      const { token, expiresAt } = await issueUserJwt(auth.jwtSecret, { userId: `google:${google.sub}`, email: google.email });
      return c.json({ ok: true, token, expiresAt, email: google.email });
    } catch (err) {
      if (err instanceof GoogleTokenError) {
        return c.json({ ok: false, code: ApiErrorCode.INVALID_GOOGLE_TOKEN, message: err.message }, 401);
      }
      console.warn("[BigFish] Google token check failed:", err instanceof Error ? err.message : err);
      return c.json({ ok: false, code: ApiErrorCode.INVALID_GOOGLE_TOKEN, message: "Could not verify the Google token." }, 502);
    }
  });

  routes.post("/ws-ticket", requireUser(auth.jwtSecret), async (c) => {
    const ticket = await tickets.issue(c.get("userId"));
    return c.json({ ok: true, ticket });
  });

  return routes;
}
