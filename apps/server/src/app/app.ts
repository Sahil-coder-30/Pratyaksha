// BigFish HTTP app: health, auth, the /mcp-ws socket for extensions, the agent, and dev routes.
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { MAX_FRAME_BYTES, WS_PATH } from "@bigfish/contracts";
import type { AuthConfig } from "../auth/config.js";
import { MemoryTicketStore, type TicketStore } from "../auth/tickets.js";
import type { AgentDeps } from "../controllers/agent.controller.js";
import { SessionRegistry } from "../mcp/registry.js";
import { RunRegistry } from "../runs.js";
import { agentRoutes } from "../routes/agent.routes.js";
import { authRoutes } from "../routes/auth.routes.js";
import { devRoutes } from "../routes/dev.routes.js";
import { devicesRoutes } from "../routes/devices.routes.js";
import { mcpWsHandler, requireTicket, type SocketTuning } from "../ws/mcp-ws.js";

export interface AppOptions {
  auth: AuthConfig;
  registry?: SessionRegistry;
  tickets?: TicketStore;
  devRoutes?: boolean;
  socket?: SocketTuning;
  agent?: Pick<AgentDeps, "models" | "limits" | "graceMs">;
}

export function createApp(opts: AppOptions) {
  const registry = opts.registry ?? new SessionRegistry();
  const tickets = opts.tickets ?? new MemoryTicketStore();
  const runs = new RunRegistry();
  const app = new Hono();
  const nodeWs = createNodeWebSocket({ app });
  // ws reads this per upgrade. Bigger frames close the socket with 1009.
  nodeWs.wss.options.maxPayload = MAX_FRAME_BYTES;

  app.get("/health", (c) => c.json({ ok: true, name: "bigfish", devices: registry.size, runs: runs.size }));
  app.get("/healthz", (c) => c.json({ ok: true, name: "bigfish", devices: registry.size, runs: runs.size }));
  app.get("/ready", (c) => c.json({ ok: true, ready: true, name: "bigfish", devices: registry.size, runs: runs.size }));
  app.get(
    WS_PATH,
    requireTicket(tickets, opts.auth.extensionOrigin),
    mcpWsHandler(nodeWs.upgradeWebSocket, { registry, socket: opts.socket }),
  );
  app.route("/api", authRoutes(opts.auth, tickets));
  app.route("/api", devicesRoutes(registry, opts.auth.jwtSecret));
  app.route("/api", agentRoutes({ registry, runs, ...opts.agent }, opts.auth.jwtSecret));
  if (opts.devRoutes) app.route("/api/dev", devRoutes(registry, opts.auth.jwtSecret));

  return { app, registry, tickets, runs, injectWebSocket: nodeWs.injectWebSocket, wss: nodeWs.wss };
}
