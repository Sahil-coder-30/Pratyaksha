#!/usr/bin/env node
/**
 * PRATYAKSHA live evaluation harness.
 *
 * Drives src/runner.js in Node against real pages in a Chromium browser
 * (Brave by default), through a puppeteer-backed chrome.* shim.
 *
 * Usage:
 *   MISTRAL_API_KEY=... node scripts/eval-agent.mjs [options]
 *
 * Options:
 *   --mock             scripted model, no API key (checks the harness plumbing only)
 *   --offline          skip tasks that need the public internet
 *   --only a,b         run only these task ids
 *   --repeat N         runs per task (default 1)
 *   --max-steps N      agent step budget per run (default 25)
 *   --timeout S        wall-clock limit per run in seconds (default 240)
 *   --headful          show the browser window
 *   --out DIR          results directory (default eval-results)
 *
 * Environment:
 *   PRATYAKSHA_EVAL_PROVIDER   mistral | gemini | openrouter (default: first provider with a key)
 *   PRATYAKSHA_EVAL_MODEL      model id override
 *   PRATYAKSHA_EVAL_API_KEY    key for the chosen provider (else MISTRAL_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY)
 *   PRATYAKSHA_EVAL_BROWSER    path to a Chromium-based browser binary
 */

import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer-core';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { createChromeShim } from './eval/chrome-shim.mjs';
import { TASKS } from './eval/tasks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'scripts/eval/fixtures');

const LLM_HOSTS = ['api.mistral.ai', 'generativelanguage.googleapis.com', 'openrouter.ai'];
const BROWSER_CANDIDATES = [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome'
];

const { values: opts } = parseArgs({
  options: {
    mock: { type: 'boolean', default: false },
    offline: { type: 'boolean', default: false },
    only: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    'max-steps': { type: 'string', default: '25' },
    timeout: { type: 'string', default: '240' },
    headful: { type: 'boolean', default: false },
    out: { type: 'string', default: 'eval-results' }
  }
});

// ── LLM call counter ────────────────────────────────────────────────────────
// Installed before the runner (and provider SDKs) load so every request is seen.
const llmCounter = { calls: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  try {
    const url = typeof input === 'string' ? input : (input?.url || String(input));
    if (LLM_HOSTS.some(h => url.includes(h))) llmCounter.calls++;
  } catch (_) {}
  return realFetch(input, init);
};

const { PratyakshaAgentRunner } = await import('../src/runner.js');

// ── Model config (keys only from env, never printed) ────────────────────────
function resolveModelConfig() {
  const keys = {
    mistral: process.env.MISTRAL_API_KEY,
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY
  };
  const provider = (process.env.PRATYAKSHA_EVAL_PROVIDER || Object.keys(keys).find(p => keys[p]) || '').toLowerCase();
  const apiKey = process.env.PRATYAKSHA_EVAL_API_KEY || keys[provider] || '';
  return { provider, apiKey, model: process.env.PRATYAKSHA_EVAL_MODEL || undefined };
}

// Scripted model for --mock: read the page, then finish with what it read.
function createMockModel(counter) {
  return {
    bindTools() {
      return {
        async invoke(messages) {
          counter.calls++;
          const toolMsgs = (messages || []).filter(m => m instanceof ToolMessage || m?._getType?.() === 'tool');
          if (toolMsgs.length === 0) {
            return new AIMessage({ content: '', tool_calls: [{ id: `mock_${counter.calls}`, name: 'read_page', args: {} }] });
          }
          const last = String(toolMsgs[toolMsgs.length - 1].content || '').replace(/\s+/g, ' ').slice(0, 300);
          return new AIMessage({
            content: '',
            tool_calls: [{ id: `mock_${counter.calls}`, name: 'finish_task', args: { success: true, summary: `Mock read: ${last}` } }]
          });
        }
      };
    }
  };
}

// ── Static fixture server ───────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

function startFixtureServer() {
  const server = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(FIXTURES, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(FIXTURES)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>404 Not found</h1>');
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ── Grounding ───────────────────────────────────────────────────────────────
const STOP = new Set('the and that this with from have were which their there about into page task tell found shows finished successfully completed article'.split(' '));

function salientTokens(text) {
  const out = new Set();
  for (const raw of String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.,-]*/gu) || []) {
    const t = raw.replace(/[.,-]+$/, '');
    if (/\d/.test(t) || (t.length >= 5 && !STOP.has(t))) out.add(t);
  }
  return [...out];
}

function grounding(summary, corpus, answerTerms = []) {
  const hay = corpus.toLowerCase();
  const tokens = salientTokens(summary);
  const found = tokens.filter(t => hay.includes(t));
  const score = tokens.length ? found.length / tokens.length : 0;
  const lowerSummary = String(summary || '').toLowerCase();
  const answerGrounded = answerTerms.every(a => lowerSummary.includes(a.toLowerCase()) && hay.includes(a.toLowerCase()));
  return {
    grounded: answerTerms.length ? answerGrounded : score >= 0.5,
    score: Number(score.toFixed(2)),
    ungroundedTokens: tokens.filter(t => !hay.includes(t)).slice(0, 8)
  };
}

// ── One run ─────────────────────────────────────────────────────────────────
async function runTask(task, ctx) {
  const { browser, shim, baseUrl, modelConfig } = ctx;
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const tabId = shim.register(page);
  shim.setActive(tabId);

  const startUrl = task.startUrl.startsWith('http') ? task.startUrl : `${baseUrl}${task.startUrl}`;
  const metrics = {
    id: task.id, category: task.category, live: !!task.live,
    success: false, passed: false, steps: 0, wallMs: 0, llmCalls: 0,
    toolCalls: 0, failedToolCalls: 0, approvals: 0, grounded: false, groundedScore: 0,
    summary: '', failureReasons: []
  };

  const observations = [];
  const pageTexts = [];
  const pending = [];
  const capturePageText = () => pending.push(
    page.evaluate(() => document.body?.innerText || '').then(t => pageTexts.push(t)).catch(() => {})
  );

  const mockCounter = { calls: 0 };
  const llmBefore = llmCounter.calls;
  const runner = new PratyakshaAgentRunner({
    provider: modelConfig.provider || 'mistral',
    apiKey: modelConfig.apiKey,
    model: ctx.mock ? 'mock' : modelConfig.model,
    chatModel: ctx.mock ? createMockModel(mockCounter) : null,
    chromeApi: shim.chromeApi,
    maxSteps: ctx.maxSteps,
    onEvent: (ev) => {
      if (ev.type === 'TOOL_CALL') metrics.toolCalls++;
      if (ev.type === 'OBSERVATION') {
        const obs = String(ev.observation || '');
        observations.push(obs);
        if (/^(ERROR|BLOCKED)/.test(obs)) metrics.failedToolCalls++;
        capturePageText();
      }
    }
  });

  const t0 = Date.now();
  let result;
  let timer;
  try {
    await page.goto(startUrl, { waitUntil: 'load', timeout: 30000 });
    capturePageText();
    const run = (async () => {
      let res = await runner.run(task.prompt, await shim.chromeApi.tabs.get(tabId));
      // The harness plays the operator and approves gated actions
      while (res?.awaitingApproval && metrics.approvals < 6) {
        metrics.approvals++;
        res = await runner.approveAction();
      }
      return res;
    })();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { runner.cancel(); reject(new Error(`timed out after ${ctx.timeoutS}s`)); }, ctx.timeoutS * 1000);
    });
    result = await Promise.race([run, timeout]);
  } catch (err) {
    result = { success: false, summary: `HARNESS_ERROR: ${err.message}`, steps: runner.lastState?.stepCount || 0, harnessError: true };
  } finally {
    clearTimeout(timer);
  }
  metrics.wallMs = Date.now() - t0;

  capturePageText();
  await Promise.allSettled(pending);

  metrics.success = !!result?.success;
  metrics.steps = result?.steps || 0;
  metrics.summary = String(result?.summary || '').slice(0, 500);
  metrics.llmCalls = ctx.mock ? mockCounter.calls : llmCounter.calls - llmBefore;
  if (result?.awaitingApproval) metrics.failureReasons.push('still awaiting approval after 6 approvals');
  if (result?.awaitingUserInput) metrics.failureReasons.push(`asked the user for input: ${metrics.summary.slice(0, 120)}`);
  if (result?.harnessError) metrics.failureReasons.push(metrics.summary);

  const answerTerms = task.expect.answer || [];
  const g = grounding(metrics.summary, [...observations, ...pageTexts].join('\n'), answerTerms);
  metrics.grounded = g.grounded;
  metrics.groundedScore = g.score;
  if (!g.grounded && g.ungroundedTokens.length) metrics.ungroundedTokens = g.ungroundedTokens;

  if (metrics.success !== task.expect.success) {
    metrics.failureReasons.push(`reported success=${metrics.success}, expected ${task.expect.success}`);
  }
  const missing = answerTerms.filter(a => !metrics.summary.toLowerCase().includes(a.toLowerCase()));
  if (missing.length) metrics.failureReasons.push(`answer missing: ${missing.join(', ')}`);
  if (task.check) {
    try {
      const c = await task.check(page);
      metrics.check = c.detail;
      if (!c.ok) metrics.failureReasons.push(`check failed: ${c.detail}`);
    } catch (err) {
      metrics.failureReasons.push(`check error: ${err.message}`);
    }
  }
  metrics.passed = metrics.failureReasons.length === 0;

  await page.close().catch(() => {});
  return metrics;
}

// ── Report ──────────────────────────────────────────────────────────────────
function summarize(runs) {
  const n = runs.length || 1;
  const sum = k => runs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return {
    runs: runs.length,
    passRate: Number((runs.filter(r => r.passed).length / n).toFixed(2)),
    groundedRate: Number((runs.filter(r => r.grounded).length / n).toFixed(2)),
    avgSteps: Number((sum('steps') / n).toFixed(1)),
    avgWallS: Number((sum('wallMs') / n / 1000).toFixed(1)),
    avgLlmCalls: Number((sum('llmCalls') / n).toFixed(1)),
    totalFailedToolCalls: sum('failedToolCalls')
  };
}

function toMarkdown(report) {
  const s = report.summary;
  const lines = [
    `# PRATYAKSHA agent eval`,
    '',
    `- Date: ${report.startedAt}`,
    `- Model: ${report.provider} / ${report.model}${report.mock ? ' (mock, plumbing check only)' : ''}`,
    `- Pass rate: **${Math.round(s.passRate * 100)}%** (${report.runs.filter(r => r.passed).length}/${s.runs}), grounded: ${Math.round(s.groundedRate * 100)}%`,
    `- Avg steps ${s.avgSteps}, avg wall ${s.avgWallS}s, avg LLM calls ${s.avgLlmCalls}, failed tool calls ${s.totalFailedToolCalls}`,
    '',
    '| Task | Category | Pass | Success | Steps | Wall (s) | LLM calls | Failed tools | Grounded | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|'
  ];
  for (const r of report.runs) {
    const notes = (r.failureReasons.join('; ') || '').replace(/\|/g, '/').slice(0, 140);
    lines.push(`| ${r.id}${r.repeat > 1 ? ` #${r.run}` : ''} | ${r.category} | ${r.passed ? 'yes' : 'no'} | ${r.success} | ${r.steps} | ${(r.wallMs / 1000).toFixed(1)} | ${r.llmCalls} | ${r.failedToolCalls} | ${r.grounded ? 'yes' : 'no'} (${r.groundedScore}) | ${notes} |`);
  }
  return lines.join('\n') + '\n';
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const mock = opts.mock;
  const modelConfig = mock ? { provider: 'mock', apiKey: '', model: 'mock' } : resolveModelConfig();
  if (!mock && (!modelConfig.provider || !modelConfig.apiKey)) {
    console.error('No model API key found. Set MISTRAL_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY (or PRATYAKSHA_EVAL_PROVIDER + PRATYAKSHA_EVAL_API_KEY).');
    console.error('Run with --mock to check the harness without a key.');
    process.exit(2);
  }

  const executablePath = process.env.PRATYAKSHA_EVAL_BROWSER || BROWSER_CANDIDATES.find(p => existsSync(p));
  if (!executablePath) {
    console.error('No Chromium-based browser found. Set PRATYAKSHA_EVAL_BROWSER to its binary path.');
    process.exit(2);
  }

  const only = opts.only ? new Set(opts.only.split(',').map(s => s.trim())) : null;
  const tasks = TASKS.filter(t => (!only || only.has(t.id)) && !(opts.offline && t.live));
  if (tasks.length === 0) {
    console.error('No tasks selected.');
    process.exit(2);
  }

  const repeat = Math.max(1, parseInt(opts.repeat, 10) || 1);
  const ctxBase = {
    mock,
    modelConfig,
    maxSteps: parseInt(opts['max-steps'], 10) || 25,
    timeoutS: parseInt(opts.timeout, 10) || 240
  };

  const server = await startFixtureServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath,
    headless: !opts.headful,
    defaultViewport: null,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate']
  });
  const shim = createChromeShim(browser, { srcDir: join(ROOT, 'src') });

  const startedAt = new Date().toISOString();
  const runner = new PratyakshaAgentRunner({ provider: modelConfig.provider === 'mock' ? 'mistral' : modelConfig.provider, model: modelConfig.model });
  const modelName = mock ? 'mock' : (modelConfig.model || runner.modelName);
  console.log(`PRATYAKSHA eval: ${tasks.length} task(s) x ${repeat}, model ${modelConfig.provider}/${modelName}, browser ${executablePath.split('/').pop()}`);

  const runs = [];
  try {
    for (const task of tasks) {
      for (let i = 1; i <= repeat; i++) {
        process.stdout.write(`- ${task.id}${repeat > 1 ? ` #${i}` : ''} ... `);
        const m = await runTask(task, { ...ctxBase, browser, shim, baseUrl });
        runs.push({ ...m, run: i, repeat });
        console.log(`${m.passed ? 'PASS' : 'FAIL'} (${m.steps} steps, ${(m.wallMs / 1000).toFixed(1)}s, ${m.llmCalls} LLM calls)`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  const report = {
    startedAt,
    provider: modelConfig.provider,
    model: modelName,
    mock,
    options: { maxSteps: ctxBase.maxSteps, timeoutS: ctxBase.timeoutS, repeat, offline: !!opts.offline },
    summary: summarize(runs),
    runs
  };

  const outDir = resolve(ROOT, opts.out);
  await mkdir(outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, '-');
  const md = toMarkdown(report);
  await writeFile(join(outDir, `eval-${stamp}.json`), JSON.stringify(report, null, 2));
  await writeFile(join(outDir, `eval-${stamp}.md`), md);
  await writeFile(join(outDir, 'latest.json'), JSON.stringify(report, null, 2));
  await writeFile(join(outDir, 'latest.md'), md);

  console.log('\n' + md);
  console.log(`Results: ${join(outDir, `eval-${stamp}.json`)} and .md`);
}

main().catch((err) => {
  console.error('Eval harness failed:', err?.stack || err);
  process.exit(1);
});
