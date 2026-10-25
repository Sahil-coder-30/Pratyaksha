// browser_screenshot in a real browser: the page is captured, the ML daemon's
// boxes are painted over with vault tokens, and nothing is sent when the
// daemon is down or cannot locate everything. A stub daemon is used by default.
// BIGFISH_E2E_ML=1 also runs the real ML daemon (needs `uv --project ML sync`).
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { E2E_ML_PORT, startHarness, type Harness } from "./harness.js";

test.describe.configure({ mode: "serial" });

const REPO_DIR = fileURLToPath(new URL("../../..", import.meta.url));
const ML_URL = `http://127.0.0.1:${E2E_ML_PORT}`;
const EMAIL = "help@fishmail.example";

let h: Harness;

test.beforeAll(async () => {
  h = await startHarness();
});

test.afterAll(async () => {
  await h?.close();
});

// A fake /v1/privacy/mask that answers with whatever the test sets.
async function startStub(answer: () => object): Promise<Server> {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.url !== "/v1/privacy/mask") return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer()));
    });
  });
  await new Promise<void>((resolve) => server.listen(E2E_ML_PORT, "127.0.0.1", resolve));
  return server;
}

// The email line's box in screenshot pixels.
async function emailBox(): Promise<number[]> {
  return h.page.evaluate(() => {
    const r = document.getElementById("email")!.getBoundingClientRect();
    const d = window.devicePixelRatio;
    return [r.left * d, r.top * d, r.right * d, r.bottom * d];
  });
}

async function openPii(): Promise<void> {
  const nav = await h.callTool("browser_navigate", { url: h.fixtureUrl("pii.html") });
  expect(nav.ok, nav.text).toBe(true);
}

test("masked spots get the same vault token as the text filter, and the image is sent", async () => {
  await openPii();
  const box = await emailBox();
  const stub = await startStub(() => ({
    imageSize: { width: 0, height: 0 },
    readyForRelease: true,
    regions: [{ id: "ENTITY_0001", category: "EMAIL", box, text: EMAIL, sources: ["regex"] }],
  }));
  try {
    const shot = await h.callTool("browser_screenshot");
    expect(shot.ok, shot.text).toBe(true);
    expect(shot.text).not.toContain(EMAIL);
    const token = shot.text.match(/\[EMAIL_[0-9A-F]{4}\]/)?.[0];
    expect(token, shot.text).toBeTruthy();
    expect(shot.image?.mimeType).toBe("image/jpeg");
    expect(shot.image!.data.length).toBeGreaterThan(1000);

    const text = await h.callTool("browser_snapshot", { mode: "text" });
    expect(text.text).toContain(token!);
  } finally {
    stub.close();
  }
});

test("a screenshot is not sent when the daemon cannot locate everything", async () => {
  await openPii();
  const stub = await startStub(() => ({ imageSize: { width: 0, height: 0 }, readyForRelease: false, regions: [] }));
  try {
    const shot = await h.callTool("browser_screenshot");
    expect(shot.ok).toBe(false);
    expect(shot.text).toMatch(/^ERROR PRIVACY_BLOCKED/);
    expect(shot.image).toBeUndefined();
  } finally {
    stub.close();
  }
});

test("a screenshot is not sent when the daemon is not running", async () => {
  await openPii();
  const shot = await h.callTool("browser_screenshot");
  expect(shot.ok).toBe(false);
  expect(shot.text).toMatch(/^ERROR ML_UNAVAILABLE/);
  expect(shot.image).toBeUndefined();
});

test("real ML daemon: private values are replaced and cannot be read back from the image", async () => {
  test.skip(process.env.BIGFISH_E2E_ML !== "1", "set BIGFISH_E2E_ML=1 to run the real ML daemon");
  test.setTimeout(300_000);
  const daemon = await startDaemon();
  try {
    await openPii();
    const shot = await h.callTool("browser_screenshot");
    expect(shot.ok, shot.text).toBe(true);
    // Saved under test-results, to look at what the model gets.
    await writeFile(test.info().outputPath("masked-screenshot.jpg"), Buffer.from(shot.image!.data, "base64"));
    for (const kind of ["EMAIL", "PHONE", "AADHAAR"]) expect(shot.text).toMatch(new RegExp(`\\[${kind}_[0-9A-F]{4}\\]`));

    // Run the masked image through the daemon again: none of the values are left.
    const again = (await (
      await fetch(`${ML_URL}/v1/privacy/mask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: `data:${shot.image!.mimeType};base64,${shot.image!.data}` }),
      })
    ).json()) as { regions: { text?: string | null }[] };
    const leftover = again.regions.map((r) => r.text ?? "").join("\n");
    for (const value of [EMAIL, "98765 43210", "2345 6789 0124"]) expect(leftover).not.toContain(value);
  } finally {
    daemon.kill();
  }
});

async function startDaemon(): Promise<ChildProcess> {
  const child = spawn("uv", ["--project", "ML", "run", "python", "-m", "ML.src.server"], {
    cwd: REPO_DIR,
    env: { ...process.env, BIGFISH_ML_PORT: String(E2E_ML_PORT), USE_TF: "0" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`ML daemon exited with ${child.exitCode}`);
    if (await fetch(`${ML_URL}/ready`).then((r) => r.ok, () => false)) return child;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  child.kill();
  throw new Error("ML daemon did not get ready");
}
