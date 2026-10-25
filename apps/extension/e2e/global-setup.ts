// Builds the extension once for E2E, pointed at the test server port.
// Output: dist/chrome-mv3-e2e (WXT adds the mode to the folder name).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { E2E_ML_PORT, E2E_SERVER_PORT } from "./harness.js";

export default function globalSetup(): void {
  execFileSync("pnpm", ["exec", "wxt", "build", "--mode", "e2e"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, WXT_SERVER_URL: `http://127.0.0.1:${E2E_SERVER_PORT}`, WXT_ML_URL: `http://127.0.0.1:${E2E_ML_PORT}` },
    stdio: "inherit",
  });
}
