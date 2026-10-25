// End-to-end tests: real Chromium with the built extension, a real BigFish
// server, and local fixture pages. Run with `pnpm --filter @bigfish/extension e2e`.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  workers: 1,
  reporter: "list",
});
