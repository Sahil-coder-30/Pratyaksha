// requireUser: Bearer JWT -> c.get("userId"). userId always comes from the
// verified token, never from the request body.
import type { MiddlewareHandler } from "hono";
import { ApiErrorCode } from "@bigfish/contracts";
import { verifyUserJwt } from "./jwt.js";

export type UserEnv = { Variables: { userId: string; email: string } };

export function requireUser(jwtSecret: Uint8Array): MiddlewareHandler<UserEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    try {
      const claims = await verifyUserJwt(jwtSecret, token);
      c.set("userId", claims.userId);
      c.set("email", claims.email);
    } catch {
      return c.json({ ok: false, code: ApiErrorCode.UNAUTHORIZED, message: "Missing or expired token." }, 401);
    }
    await next();
  };
}
