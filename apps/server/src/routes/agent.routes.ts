// /api/agent/*: run and cancel the agent. Signed-in users only.
import { Hono } from "hono";
import { requireUser, type UserEnv } from "../auth/middleware.js";
import { agentController, type AgentDeps } from "../controllers/agent.controller.js";

export function agentRoutes(deps: AgentDeps, jwtSecret: Uint8Array) {
  const routes = new Hono<UserEnv>();
  const controller = agentController(deps);

  routes.use("/agent/*", requireUser(jwtSecret));
  routes.post("/agent/invoke", controller.invoke);
  routes.post("/agent/cancel", controller.cancel);

  return routes;
}
