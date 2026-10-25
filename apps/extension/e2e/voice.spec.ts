// Voice input in the side panel. Real speech cannot run in a test, so the
// panel gets a fake SpeechRecognition that the test drives. The mic
// permission page runs for real against Chromium's fake mic device.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { launchExtension } from "./harness.js";

test.describe.configure({ mode: "serial" });

type Result = [transcript: string, isFinal: boolean];

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtension(["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]));

  await context.addInitScript(() => {
    if (!location.pathname.endsWith("/sidepanel.html")) return;
    const w = window as any;
    if (location.search.includes("nospeech")) {
      for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
        Object.defineProperty(w, name, { value: undefined, configurable: true, writable: true });
      }
      return;
    }
    w.__speech = { rec: null, log: [] as string[] };
    class FakeSpeechRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() {
        w.__speech.rec = this;
      }
      start() {
        w.__speech.log.push("start");
      }
      stop() {
        w.__speech.log.push("stop");
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {
        w.__speech.log.push("abort");
        setTimeout(() => {
          this.onerror?.({ error: "aborted" });
          this.onend?.();
        }, 0);
      }
      // `results` is the whole session so far, like the real API.
      emit(results: [string, boolean][], resultIndex = 0) {
        this.onresult?.({ resultIndex, results: results.map(([t, isFinal]) => ({ isFinal, 0: { transcript: t } })) });
      }
      fail(error: string) {
        this.onerror?.({ error });
        this.onend?.();
      }
    }
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(w, name, { value: FakeSpeechRecognition, configurable: true, writable: true });
    }
  });
});

test.afterAll(async () => {
  await context?.close();
});

async function openPanel(query = ""): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html${query}`);
  return panel;
}

const emit = (panel: Page, results: Result[], resultIndex = 0) =>
  panel.evaluate(([r, i]) => (window as any).__speech.rec.emit(r, i), [results, resultIndex] as const);

const fail = (panel: Page, error: string) => panel.evaluate((e) => (window as any).__speech.rec.fail(e), error);

const speechLog = (panel: Page) => panel.evaluate(() => (window as any).__speech.log as string[]);

test("dictation fills the box live and keeps the text after stop", async () => {
  const panel = await openPanel();
  const mic = panel.locator("#btn-mic");
  const input = panel.locator("#cmd-input");
  const hint = panel.locator("#input-hint");

  await expect(mic).toBeVisible();
  await expect(hint).toHaveText("Enter to run");

  await mic.click();
  await expect(mic).toHaveAttribute("data-listening", "true");
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toHaveText("Listening... tap the mic to stop");
  const settings = await panel.evaluate(() => {
    const rec = (window as any).__speech.rec;
    return { continuous: rec.continuous, interim: rec.interimResults, lang: rec.lang };
  });
  expect(settings).toEqual({ continuous: true, interim: true, lang: expect.any(String) });
  expect(settings.lang).not.toBe("");

  await emit(panel, [["summarize", false]]);
  await expect(input).toHaveValue("summarize");

  await emit(panel, [["summarize this page", true]]);
  await expect(input).toHaveValue("summarize this page");

  // A new phrase after a final one: resultIndex points at the new result only.
  await emit(panel, [["summarize this page", true], ["in short", false]], 1);
  await expect(input).toHaveValue("summarize this page in short");

  await mic.click();
  await expect(mic).toHaveAttribute("data-listening", "false");
  await expect(hint).toHaveText("Enter to run");
  // The interim part was never confirmed, so it drops on stop.
  await expect(input).toHaveValue("summarize this page");
  await expect(input).toBeFocused();
  expect(await speechLog(panel)).toEqual(["start", "stop"]);
  await panel.close();
});

test("speech is added after text already in the box", async () => {
  const panel = await openPanel();
  const input = panel.locator("#cmd-input");
  await input.fill("Open the pricing page and");

  await panel.locator("#btn-mic").click();
  await emit(panel, [["click on sign up", true]]);
  await expect(input).toHaveValue("Open the pricing page and click on sign up");

  await panel.locator("#btn-mic").click();
  await expect(input).toHaveValue("Open the pricing page and click on sign up");
  await panel.close();
});

test("sending with Enter stops dictation and the box stays empty", async () => {
  const panel = await openPanel();
  const input = panel.locator("#cmd-input");

  await panel.locator("#btn-mic").click();
  await emit(panel, [["extract the table", true], ["now", false]]);
  await expect(input).toHaveValue("extract the table now");

  await input.press("Enter");
  // The prompt went to the feed (the run fails here: no server, not signed in).
  await expect(panel.locator(".user-prompt-card")).toHaveText("extract the table now");
  await expect(panel.locator("#btn-mic")).toHaveAttribute("data-listening", "false");
  expect(await speechLog(panel)).toEqual(["start", "abort"]);
  // A late onend must not put the spoken text back.
  await panel.waitForTimeout(200);
  await expect(input).toHaveValue("");
  await panel.close();
});

test("errors show in the hint and the mic can start again", async () => {
  const panel = await openPanel();
  const mic = panel.locator("#btn-mic");
  const hint = panel.locator("#input-hint");

  await mic.click();
  await fail(panel, "no-speech");
  await expect(hint).toHaveText("No speech heard. Try again.");
  await expect(hint).toHaveAttribute("data-state", "error");
  await expect(mic).toHaveAttribute("data-listening", "false");

  await mic.click();
  await expect(mic).toHaveAttribute("data-listening", "true");
  await expect(hint).toHaveText("Listening... tap the mic to stop");
  await mic.click();

  // Service errors are not a permission problem, so no permission tab opens.
  const pagesBefore = context.pages().length;
  await mic.click();
  await fail(panel, "service-not-allowed");
  await expect(hint).toHaveText("Voice input is not available in this browser.");
  await panel.waitForTimeout(300);
  expect(context.pages().length).toBe(pagesBefore);
  await panel.close();
});

test("mic blocked: the permission page opens and gets access", async () => {
  const panel = await openPanel();
  await panel.locator("#btn-mic").click();

  const permissionPage = context.waitForEvent("page");
  await fail(panel, "not-allowed");
  await expect(panel.locator("#input-hint")).toHaveText("Allow the microphone in the tab that opened, then tap the mic again.");

  const page = await permissionPage;
  expect(page.url()).toBe(`chrome-extension://${extensionId}/mic-permission.html`);
  // Chromium's fake mic grants access, so the page confirms and closes itself.
  await expect(page.locator("#status")).toHaveText("Microphone allowed. Go back to BigFish and tap the mic again.");
  await page.waitForEvent("close", { timeout: 5000 });
  await panel.close();
});

test("permission page explains how to fix a denied mic", async () => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await page.goto(`chrome-extension://${extensionId}/mic-permission.html`);
  await expect(page.locator("#status")).toContainText("Microphone was blocked.");
  await page.close();
});

test("the mic button hides when the browser has no speech API", async () => {
  const panel = await openPanel("?nospeech");
  await expect(panel.locator("#cmd-input")).toBeVisible();
  await expect(panel.locator("#btn-mic")).toBeHidden();
  await panel.close();
});
