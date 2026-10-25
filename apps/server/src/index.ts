// BigFish server entrypoint.
import { agentModels, modelConfigFromEnv } from "./agent/models.js";
import { authConfigFromEnv } from "./auth/config.js";
import { startServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const DEV = process.env.ENABLE_DEV_ROUTES === "1";
const models = modelConfigFromEnv(process.env);
if (!models) console.warn("[BigFish] No NVIDIA_API_KEY, OPEN_ROUTER_API_KEY or MISTRAL_API_KEY set. /api/agent/invoke answers 503.");

const { port, close } = await startServer({
  port: PORT,
  host: HOST,
  devRoutes: DEV,
  auth: authConfigFromEnv(process.env, { dev: DEV }),
  agent: { models: models && agentModels(models) },
});
console.log(`[BigFish] server on http://${HOST}:${port} (extensions dial ws://${HOST}:${port}/mcp-ws)`);
if (models) console.log(`[BigFish] agent ${models.provider} model ${models.model}, judge ${models.judgeModel}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`[BigFish] ${signal}, closing`);
    void close().then(() => process.exit(0));
  });
}
