// Agent evals: the real agent (real model) drives a real browser on the local
// fixtures. Each case has a start page, a prompt and a check on the page or
// the answer. Approvals are auto-approved in the side panel.
// Run: NVIDIA_API_KEY=... (or OPEN_ROUTER_API_KEY=...) pnpm --filter @bigfish/extension exec tsx e2e/agent-eval.ts [case...]
// Needs the e2e build: pnpm --filter @bigfish/extension exec wxt build --mode e2e
import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { startHarness, type Harness } from "./harness.js";

interface Event {
  type: string;
  [key: string]: unknown;
}

interface Run {
  events: Event[];
  answer: string;
  error?: string;
}

interface Case {
  name: string;
  // Fixture pages open before the run. The last one is the active tab.
  start: string[];
  prompt: (url: (name: string) => string) => string;
  // A string is a failure reason. null means passed.
  check: (run: Run, pages: Page[]) => Promise<string | null>;
}

const has = (text: string, ...parts: (string | RegExp)[]) => parts.every((p) => (typeof p === "string" ? text.toLowerCase().includes(p.toLowerCase()) : p.test(text)));

async function submitted(pages: Page[], key: "__submitted" | "__sent"): Promise<Record<string, string> | null> {
  for (const page of pages) {
    const value = await page.evaluate((k) => (window as any)[k] ?? null, key).catch(() => null);
    if (value) return value;
  }
  return null;
}

function navigations(run: Run): string[] {
  return run.events.filter((e) => e.type === "tool_call" && e.name === "browser_navigate").map((e) => JSON.stringify(e.args));
}

const CASES: Case[] = [
  {
    name: "gform_with_values",
    start: ["heading.html"],
    prompt: (u) => `Open ${u("gform.html")}, fill it with name "Sahil Sharma", pick the AI Agents track, rate it 5, answer the rest yourself, then submit.`,
    check: async (_run, pages) => {
      const s = await submitted(pages, "__submitted");
      if (!s) return "form was not submitted";
      if (s.name !== "Sahil Sharma") return `name was ${JSON.stringify(s.name)}`;
      if (s.track !== "AI Agents") return `track was ${JSON.stringify(s.track)}`;
      if (s.rating !== "5") return `rating was ${JSON.stringify(s.rating)}`;
      if (!has(s.capital ?? "", "paris")) return `capital was ${JSON.stringify(s.capital)}`;
      if ((s.feedback ?? "").length < 20) return "feedback too short";
      if (s.phone) return `phone was invented: ${s.phone}`;
      return null;
    },
  },
  {
    name: "gform_link_only",
    start: ["heading.html"],
    prompt: (u) => `${u("gform.html")}?usp=publish-editor fill this google form`,
    check: async (run, pages) => {
      if (!navigations(run).some((n) => n.includes("gform.html"))) return "never opened the link";
      const s = await submitted(pages, "__submitted");
      if (s?.name) return `submitted with an invented name ${JSON.stringify(s.name)}`;
      if (!has(run.answer, "name")) return "did not tell the user the name is needed";
      return null;
    },
  },
  {
    name: "gform_in_open_tab",
    start: ["gform.html", "heading.html"],
    prompt: () => `Fill the hackathon feedback form in my other tab. Name is Asha, pick anything sensible for the rest, then submit.`,
    check: async (_run, pages) => {
      const s = await submitted(pages, "__submitted");
      if (!s) return "form was not submitted";
      if (s.name !== "Asha") return `name was ${JSON.stringify(s.name)}`;
      return null;
    },
  },
  {
    name: "no_link_given",
    start: ["heading.html"],
    prompt: () => `Fill the feedback form and submit it.`,
    check: async (run, pages) => {
      if (await submitted(pages, "__submitted")) return "submitted a form the user never named";
      // Following a link on the open page is fine. Typing a URL or digging in history is guessing.
      const navs = navigations(run);
      if (navs.length) return `guessed a page: ${navs.join(", ")}`;
      return null;
    },
  },
  {
    name: "shop_cheapest",
    start: ["heading.html"],
    prompt: (u) => `On ${u("shop.html")}, find the cheapest laptop and tell me its price and rating.`,
    check: async (run) => (has(run.answer, "zen 13") && has(run.answer, /48,?999/) && has(run.answer, "4.4") ? null : `answer: ${run.answer}`),
  },
  {
    name: "table_read",
    start: ["table.html"],
    prompt: () => `What is Pune's population and how many metro lines does it have?`,
    check: async (run) => (has(run.answer, "71.3") && has(run.answer, /\b3\b/) ? null : `answer: ${run.answer}`),
  },
  {
    name: "mail_send",
    start: ["mail.html"],
    prompt: () => `Send an email to ravi.k@example.com with subject "Standup" saying I will join at 11:15.`,
    check: async (_run, pages) => {
      const s = await submitted(pages, "__sent");
      if (!s) return "mail was not sent";
      if (s.to !== "ravi.k@example.com") return `to was ${JSON.stringify(s.to)}`;
      if (s.subject !== "Standup") return `subject was ${JSON.stringify(s.subject)}`;
      if (!has(s.body ?? "", "11:15")) return `body was ${JSON.stringify(s.body)}`;
      return null;
    },
  },
  {
    name: "chat_ask",
    start: ["chat.html"],
    prompt: () => `Ask HelpBot how long refunds take and tell me the ticket number it gives.`,
    check: async (run) => (has(run.answer, "RF-4821") && has(run.answer, /5 to 7|5-7/) ? null : `answer: ${run.answer}`),
  },
  {
    name: "nav_back",
    start: ["heading.html"],
    prompt: () => `Click "Go to the form" on this page, then go back and tell me the main heading of the first page.`,
    check: async (run) => (has(run.answer, "Welcome to the BigFish test page") ? null : `answer: ${run.answer}`),
  },
];

async function invoke(serverUrl: string, token: string, deviceId: string, prompt: string): Promise<Run> {
  const res = await fetch(`${serverUrl}/api/agent/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceId, prompt }),
  });
  if (!res.ok || !res.body) return { events: [], answer: "", error: `HTTP ${res.status} ${await res.text()}` };
  const run: Run = { events: [], answer: "" };
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split("\n").find((l) => l.startsWith("data:"));
      if (!data) continue;
      const event = JSON.parse(data.slice(5)) as Event;
      run.events.push(event);
      if (event.type === "final") run.answer = String(event.answer);
      if (event.type === "error") run.error = `${event.code}: ${event.message}`;
    }
  }
  return run;
}

// Fresh tabs per case, so no history or state leaks from the case before.
async function resetTabs(h: Harness, start: string[]): Promise<Page[]> {
  const old = h.context.pages().filter((p) => p !== h.panel);
  const opened: Page[] = [];
  for (const name of start) {
    const p = await h.context.newPage();
    await p.goto(h.fixtureUrl(name));
    opened.push(p);
  }
  for (const p of old) await p.close();
  await opened.at(-1)!.bringToFront();
  return opened;
}

function trace(run: Run): string {
  return run.events
    .map((e) => {
      if (e.type === "plan") return `PLAN ${JSON.stringify(e.subtasks)}`;
      if (e.type === "step") return `STEP [${e.node}${e.subtask ? ` ${e.subtask}` : ""}] ${e.message}`;
      if (e.type === "tool_call") return `  CALL ${e.name} ${JSON.stringify(e.args)}`;
      if (e.type === "tool_result") return `  ${e.ok ? "OK" : "FAIL"} ${String(e.text).replace(/\n/g, "\n     ").slice(0, 900)}`;
      if (e.type === "final") return `FINAL ${e.answer}`;
      if (e.type === "error") return `ERROR ${e.code} ${e.message}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function main() {
  // The model settings the server reads (see apps/server/.env.example).
  const serverEnv = Object.fromEntries(
    ["NVIDIA_API_KEY", "NVIDIA_MODEL", "NVIDIA_JUDGE_MODEL", "OPEN_ROUTER_API_KEY", "OPEN_ROUTER_MODEL", "OPEN_ROUTER_JUDGE_MODEL"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]!]),
  );
  if (!serverEnv.NVIDIA_API_KEY && !serverEnv.OPEN_ROUTER_API_KEY) throw new Error("Set NVIDIA_API_KEY or OPEN_ROUTER_API_KEY.");
  const only = process.argv.slice(2);
  const cases = only.length ? CASES.filter((c) => only.includes(c.name)) : CASES;
  const outDir = process.env.EVAL_OUT ?? "test-results/agent-eval";
  await mkdir(outDir, { recursive: true });

  const h = await startHarness({ serverEnv });
  const approve = setInterval(() => {
    h.panel.locator(".approval-card button.btn-confirm-sm:not([disabled])").first().click({ timeout: 200 }).catch(() => {});
  }, 300);
  const results: string[] = [];
  try {
    const login = (await (await fetch(`${h.serverUrl}/api/dev/login`, { method: "POST" })).json()) as { token: string };
    const deviceId = ((await (await fetch(`${h.serverUrl}/api/dev/devices`)).json()) as { deviceId: string }[])[0]!.deviceId;
    for (const [i, c] of cases.entries()) {
      // Some providers allow few requests a minute: space the runs out.
      if (i > 0) await new Promise((r) => setTimeout(r, Number(process.env.EVAL_PAUSE_MS ?? 20_000)));
      await resetTabs(h, c.start);
      const started = Date.now();
      const run = await invoke(h.serverUrl, login.token, deviceId, c.prompt(h.fixtureUrl));
      const pages = h.context.pages().filter((p) => p !== h.panel);
      const failure = run.error ? `run error ${run.error}` : await c.check(run, pages);
      const calls = run.events.filter((e) => e.type === "tool_call").length;
      const line = `${failure ? "FAIL" : "PASS"} ${c.name} (${Math.round((Date.now() - started) / 1000)}s, ${calls} tools)${failure ? `: ${failure}` : ""}`;
      console.log(line);
      results.push(line);
      await writeFile(`${outDir}/${c.name}.txt`, `PROMPT ${c.prompt(h.fixtureUrl)}\n${line}\n\n${trace(run)}\n`);
    }
  } finally {
    clearInterval(approve);
    await writeFile(`${outDir}/summary.txt`, results.join("\n") + "\n");
    await h.close();
  }
}

await main();
