/**
 * PRATYAKSHA LangGraph StateGraph Autonomous Browser Engine
 * Sovereign, Privacy-First Browser Agent
 *
 * Perception → Reason → Execute → Observe → (Backtrack/Recover) loop.
 * Powered by Mistral AI (codestral-latest / mistral-large) with Gemini fallback.
 * Includes:
 * - Mechanical Backtracking & State Rollback (go_back on dead ends)
 * - Strict Loop & Dead-End Detection (action signature matching & repetition prevention)
 * - Dynamic Target Blacklisting & Self-Correction Prompts
 * - Anti-Hallucination Mechanical Verification Gate
 * - Canonical Service Pre-Flight Routing
 */

import {
  BROWSER_TOOL_DECLARATIONS,
  MISTRAL_TOOL_DECLARATIONS,
  executeBrowserTool
} from './browser-tools.js';

// ─────────────────────────────────────────────────────────
// Canonical Web Services Directory
// ─────────────────────────────────────────────────────────
export const CANONICAL_SERVICES = [
  { pattern: /\bgmail\b/i, url: 'https://mail.google.com', name: 'Gmail', hostMatch: /mail\.google\.com/i },
  { pattern: /\byoutube\b/i, url: 'https://www.youtube.com', name: 'YouTube', hostMatch: /youtube\.com/i },
  { pattern: /\bgithub\b/i, url: 'https://github.com', name: 'GitHub', hostMatch: /github\.com/i },
  { pattern: /\b(cricbuzz|cricket score)\b/i, url: 'https://www.cricbuzz.com', name: 'Cricbuzz', hostMatch: /cricbuzz\.com/i },
  { pattern: /\bwikipedia\b/i, url: 'https://www.wikipedia.org', name: 'Wikipedia', hostMatch: /wikipedia\.org/i },
  { pattern: /\b(twitter|x\.com)\b/i, url: 'https://x.com', name: 'Twitter/X', hostMatch: /x\.com|twitter\.com/i },
  { pattern: /\breddit\b/i, url: 'https://www.reddit.com', name: 'Reddit', hostMatch: /reddit\.com/i },
  { pattern: /\b(google search|google\.com)\b/i, url: 'https://www.google.com', name: 'Google', hostMatch: /google\.com/i }
];

export function detectTargetService(task = '') {
  for (const s of CANONICAL_SERVICES) {
    if (s.pattern.test(task)) return s;
  }
  const urlMatch = task.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    try {
      const u = new URL(urlMatch[0]);
      return { pattern: null, url: u.href, name: u.hostname, hostMatch: new RegExp(u.hostname.replace(/\./g, '\\.'), 'i') };
    } catch (_) {}
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// DOM table formatter — with dynamic target blacklisting
// ─────────────────────────────────────────────────────────
function buildDOMTable(elements = [], max = 75, blacklistedTargets = new Set()) {
  if (!elements.length) return 'No interactive elements detected.';

  const header = '[ID]  TAG            TYPE/ROLE     LABEL / PLACEHOLDER / TEXT                     STATUS/VAL';
  const sep    = '─'.repeat(header.length);

  // Deprioritize blacklisted elements, prioritize visible form inputs and buttons
  const sorted = [...elements].sort((a, b) => {
    const isBlA = blacklistedTargets.has(Number(a.id));
    const isBlB = blacklistedTargets.has(Number(b.id));
    if (isBlA && !isBlB) return 1;
    if (!isBlA && isBlB) return -1;

    const isInputA = /input|textarea|textbox|combobox/i.test(`${a.tag} ${a.type} ${a.role}`);
    const isInputB = /input|textarea|textbox|combobox/i.test(`${b.tag} ${b.type} ${b.role}`);
    if (isInputA && !isInputB) return -1;
    if (!isInputA && isInputB) return 1;
    return 0;
  });

  const rows = sorted.slice(0, max).map(el => {
    const isBl = blacklistedTargets.has(Number(el.id));
    const id    = String(el.id || '').padStart(4, ' ');
    const tag   = `<${el.tag || '?'}>`.padEnd(14, ' ');
    const type  = (el.type || el.role || '').padEnd(13, ' ');
    let label   = (el.label || el.text || '').replace(/\s+/g, ' ').slice(0, 46);
    if (isBl) {
      label = `[FAILED/DO-NOT-USE] ${label}`.slice(0, 46);
    }
    label = label.padEnd(46, ' ');
    const val   = isBl ? '⚠️ BLACKLISTED' : (el.value ? `"${el.value.slice(0, 20)}"` : '');
    return `[${id}]  ${tag} ${type} ${label} ${val}`;
  });

  return [header, sep, ...rows].join('\n');
}

// ─────────────────────────────────────────────────────────
// System prompt factory
// ─────────────────────────────────────────────────────────
function buildSystemPrompt(pageContext, stepCount, maxSteps, targetService = null, taskObjective = '', blacklistedTargets = new Set()) {
  const table = buildDOMTable(pageContext.elements, 75, blacklistedTargets);
  const currentUrl = pageContext.url || '';
  const isWrongDomain = targetService && !targetService.hostMatch.test(currentUrl);

  let navDirective = '';
  if (isWrongDomain) {
    navDirective = `
🚨 CRITICAL DOMAIN MISMATCH WARNING:
The user objective requires "${targetService.name}" (${targetService.url}), but the browser is currently at "${currentUrl}".
You CANNOT complete the user goal on this page.
YOUR VERY FIRST ACTION RIGHT NOW MUST BE:
open_url({ "url": "${targetService.url}", "rationale": "Navigating to ${targetService.name}" })
DO NOT click random buttons or links on the current page! Navigate to ${targetService.url} immediately!
`;
  }

  let blacklistWarning = '';
  if (blacklistedTargets.size > 0) {
    blacklistWarning = `
⚠️ ACTIVE BLACKLIST NOTICE:
The following element IDs have already failed, timed out, or caused dead ends: [${Array.from(blacklistedTargets).join(', ')}].
DO NOT TARGET THESE ELEMENTS AGAIN. Attempting to use them will trigger an automatic backtrack error.
`;
  }

  return `You are PRATYAKSHA (प्रत्यक्ष) — a world-class sovereign, privacy-first autonomous browser agent.
You operate a real browser tab. You perceive the current page and call tools to complete the user's goal.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT OBJECTIVE: ${taskObjective || 'Complete user request'}
CURRENT PAGE  (Step ${stepCount}/${maxSteps})
URL  : ${currentUrl || 'unknown'}
Title: ${pageContext.title || 'unknown'}

INTERACTIVE ELEMENTS (sorted by relevance, inputs first):
${table}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${navDirective}
${blacklistWarning}
STRATEGY RULES — read carefully before every action:

🔴 RULE 0 – NAVIGATION FIRST
  If the user's task mentions a specific website, service, or URL (e.g. Gmail, YouTube, Google, Cricbuzz, GitHub)
  and the CURRENT PAGE does NOT match that destination:
  You MUST call open_url({ "url": "..." }) as your VERY FIRST action.
  Never interact with an unrelated page when a specific service was requested.

🔴 RULE 1 – EMAIL & MESSAGING WORKFLOW (e.g. Gmail)
  If the user wants to send an email or message:
  1. Verify you are on the service URL (e.g. https://mail.google.com). If not, open_url first.
  2. If the compose dialog is not open (no recipient field in the elements table),
     click the "Compose" / "New Email" / "+" button first.
  3. Once the compose dialog is open:
     - Use type_into_element to type the recipient into the recipient field (label/placeholder: "To", "Recipients").
     - Use type_into_element to type into the Subject field.
     - Use type_into_element to type into the Message Body field (contenteditable or textbox).
     - Use click_element to click the "Send" button.
  Only after the Send button is clicked may you call finish_task.

🔴 RULE 2 – TARGET BY ID, ALWAYS
  Every click_element and type_into_element call MUST include "target_id": <number>.
  The [ID] column in the table is the exact number to use.
  This is the only guaranteed-accurate targeting method.

🔴 RULE 3 – MANDATORY TOOL CALLS (NEVER REPLY WITH JUST TEXT)
  You MUST invoke at least one tool on EVERY single turn until the goal is verified.
  Never return conversational text without calling an actionable tool. If you need to wait, call wait_seconds or wait_for.

🔴 RULE 4 – ZERO HALLUCINATION (VERIFIED COMPLETION ONLY)
  Never call finish_task(success:true) or output text claiming you finished the task unless you have
  ACTUALLY executed the necessary steps on the real target website.
  For email sending: you MUST have navigated to Gmail, typed into the recipient and body fields,
  and clicked Send. Saying "I sent an email" without performing these actions will be mechanically rejected.

🔴 RULE 5 – ONE CLICK PER STEP (for navigation/modal triggers)
  After clicking a button that opens a new page or modal, return ONLY that one click.
  Do NOT batch type_into_element calls in the same step — the fields don't exist yet.

🔴 RULE 6 – MULTI-FIELD FILL WHEN MODAL IS OPEN
  Once compose/form fields are present in the table, you may batch multiple
  type_into_element calls in a single step to fill all fields cleanly.

🔴 RULE 7 – ADAPTIVE BACKTRACKING & SELF-CORRECTION
  When an action fails, takes you to an unexpected page, or does not advance the objective:
  1. NEVER REPEAT A FAILING TARGET. If click_element on [ID 8] failed, trying [ID 8] again is forbidden.
  2. If an action led you to an irrelevant page or dead end, call go_back immediately to return to the previous page.
  3. If an expected field/button is not in the DOM table:
     - Call scroll_page({ direction: "down", pixels: 600 }) to bring off-screen elements into view.
     - Call wait_for to wait for dynamic SPAs to finish rendering.
     - Look for alternative buttons (e.g. "+", icon buttons, "Write", "New").
  4. Reflect on what went wrong and pick an alternative branch.

🔴 RULE 8 – FINISH CORRECTLY
  Call finish_task(success:true) ONLY AFTER the actions (e.g. Send click) have actually succeeded.
  Include key details: URL visited, fields typed, and confirmation in the summary.`;
}

// ─────────────────────────────────────────────────────────
// LangGraphAgent
// ─────────────────────────────────────────────────────────
export class LangGraphAgent {
  constructor(options = {}) {
    this.provider  = options.provider  || 'mistral';
    this.apiKey    = (options.apiKey   || '').trim();
    this.model     = options.model     || (this.provider === 'mistral' ? 'mistral-large-latest' : 'gemini-3.8-flash');
    this.vault     = options.vault     || null;
    this.maxSteps  = options.maxSteps  || 20;
    this.onEvent   = options.onEvent   || (() => {});
    this.isCancelled = false;
    this.abortController = new AbortController();

    this.state = {
      task: '', sanitizedTask: '', messages: [],
      activeTab: null, domElements: [], actionHistory: [],
      checkpoints: [],
      blacklistedTargets: new Set(),
      consecutiveFailures: 0,
      lastActionSig: null,
      stepCount: 0, status: 'IDLE', finalSummary: null
    };
  }

  cancel() {
    this.isCancelled = true;
    this.state.status = 'CANCELLED';
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch (_) {}
    }
    this._clearCursorAndHighlight().catch(() => {});
    this._emit('CANCELLED', { message: 'Agent stopped immediately by user.' });
  }

  async _clearCursorAndHighlight() {
    const tabId = this.state.activeTab?.id;
    if (!tabId) return;
    try {
      await new Promise(resolve => {
        chrome.tabs.sendMessage(tabId, { type: 'CLEAR_HIGHLIGHT' }, () => {
          if (chrome.runtime.lastError) {}
          resolve();
        });
      });
    } catch (_) {}
    try {
      await new Promise(resolve => {
        chrome.tabs.sendMessage(tabId, { type: 'SET_CONTROL_ACTIVE', active: false }, () => {
          if (chrome.runtime.lastError) {}
          resolve();
        });
      });
    } catch (_) {}
    try {
      await new Promise(resolve => {
        chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_ACTION', payload: { action: 'CLEAR_HIGHLIGHT' } }, () => {
          if (chrome.runtime.lastError) {}
          resolve();
        });
      });
    } catch (_) {}
  }

  async _setScreenControl(active = true) {
    const tabId = this.state.activeTab?.id;
    if (!tabId) return;
    try {
      await new Promise(resolve => {
        chrome.tabs.sendMessage(tabId, { type: 'SET_CONTROL_ACTIVE', active }, () => {
          if (chrome.runtime.lastError) {}
          resolve();
        });
      });
    } catch (_) {}
  }

  _emit(type, payload = {}) {
    this.onEvent({ type, step: this.state.stepCount, timestamp: new Date().toLocaleTimeString(), ...payload });
  }

  // ───────────────────────────────────────────────────────
  // Main run loop
  // ───────────────────────────────────────────────────────
  async run(userTask, activeTab) {
    this.isCancelled = false;
    this.abortController = new AbortController();
    this.state = {
      task: userTask, sanitizedTask: '', messages: [],
      activeTab, domElements: [], actionHistory: [],
      checkpoints: [],
      blacklistedTargets: new Set(),
      consecutiveFailures: 0,
      lastActionSig: null,
      stepCount: 0, status: 'RUNNING', finalSummary: null
    };

    // Activate glowing screen control border on the inspected tab
    this._setScreenControl(true).catch(() => {});

    // 1. Privacy sanitize
    const { sanitizedText, detected } = this.vault?.anonymize
      ? this.vault.anonymize(userTask)
      : { sanitizedText: userTask, detected: [] };

    this.state.sanitizedTask = sanitizedText;
    this._emit('TASK_START', { task: userTask, sanitized: sanitizedText, detectedCount: detected.length, provider: this.provider, model: this.model });
    if (detected.length) this._emit('PII_MASKED', { detected });

    // Seed conversation
    this._addUserMessage(`User Objective: ${sanitizedText}`);

    // Pre-flight check: Target service detection
    const targetService = detectTargetService(userTask);

    // 2. Main loop
    while (!this.isCancelled && this.state.stepCount < this.maxSteps) {
      this.state.stepCount++;

      // Perceive
      this._emit('STATE_CHANGE', { state: 'PERCEIVING', label: `Step ${this.state.stepCount}: Scanning DOM…` });
      const pageCtx = await this._perceive();
      this.state.domElements = pageCtx.elements || [];

      // Save valid state checkpoint for backtracking
      if (pageCtx.url && (!targetService || targetService.hostMatch.test(pageCtx.url))) {
        if (!this.state.checkpoints.some(cp => cp.url === pageCtx.url)) {
          this.state.checkpoints.push({
            step: this.state.stepCount,
            url: pageCtx.url,
            title: pageCtx.title,
            elementsCount: pageCtx.elements?.length || 0
          });
        }
      }

      // Step 1 fast path: If target service requested and tab is on wrong page, navigate immediately
      if (this.state.stepCount === 1 && targetService && !targetService.hostMatch.test(pageCtx.url || '')) {
        this._emit('STATE_CHANGE', { state: 'ACTING', label: `Step 1: Navigating to ${targetService.name} (${targetService.url})…` });
        const navAction = {
          toolName: 'open_url',
          args: { url: targetService.url, rationale: `Navigating to ${targetService.name} as requested by user.` },
          callId: this._id()
        };
        const navResult = await executeBrowserTool(navAction.toolName, navAction.args, this.state.activeTab, this.vault);
        navAction.observation = navResult.observation || 'Opened.';
        this._recordTurn([navAction]);
        this.state.actionHistory.push({ toolName: 'open_url', args: navAction.args, url: targetService.url, observation: navAction.observation });
        this._emit('TOOL_CALL', { toolName: 'open_url', args: navAction.args });
        this._emit('OBSERVATION', { observation: navAction.observation });
        await this._sleep(1000);
        continue;
      }

      // Reason
      this._emit('STATE_CHANGE', { state: 'REASONING', label: `Step ${this.state.stepCount}: Reasoning (${this.model})…` });
      let decision;
      try {
        decision = this.provider === 'mistral'
          ? await this._reasonMistral(pageCtx, targetService)
          : await this._reasonGemini(pageCtx, targetService);
      } catch (err) {
        if (err.message === 'STOPPED_BY_USER' || this.isCancelled || this.abortController?.signal?.aborted) {
          break;
        }
        this._emit('TOOL_ERROR', { error: `Reasoning failed: ${err.message}` });
        await this._sleep(2000);
        continue;
      }

      if (this.isCancelled || this.abortController?.signal?.aborted) break;
      if (decision.thought) this._emit('THOUGHT', { thought: decision.thought });

      // Normalise actions
      let actions = decision.actions || [];
      if (!actions.length) {
        actions = [{ toolName: 'wait_seconds', args: { seconds: 2, reason: 'Scanning DOM for interactive elements' }, callId: this._id() }];
      }

      // ── REPETITIVE ACTION LOOP DETECTION ──
      const firstAction = actions[0];
      const currentSig = firstAction ? `${firstAction.toolName}:${JSON.stringify(firstAction.args)}` : '';

      if (currentSig && currentSig === this.state.lastActionSig && firstAction.toolName !== 'wait_seconds' && firstAction.toolName !== 'finish_task') {
        this.state.consecutiveFailures++;
        this._emit('STATE_CHANGE', {
          state: 'BACKTRACKING',
          label: `⚠️ Loop Detected: Repeated action "${firstAction.toolName}". Triggering self-correction…`
        });

        if (firstAction.args?.target_id) {
          this.state.blacklistedTargets.add(Number(firstAction.args.target_id));
        }

        this._addUserMessage(`🚨 LOOP DETECTED: You repeated the exact same action: ${firstAction.toolName}(${JSON.stringify(firstAction.args)}). This action did not make progress and is now BLACKLISTED. You must choose a DIFFERENT tool or element from the table.`);

        // Replace action with a pivot scroll to reveal alternative elements
        actions = [{
          toolName: 'scroll_page',
          args: { direction: 'down', pixels: 500 },
          callId: this._id()
        }];
      }
      this.state.lastActionSig = currentSig;

      // ── MECHANICAL VERIFICATION GATE BEFORE ACCEPTING finish_task ──
      const finish = actions.find(a => a.toolName === 'finish_task');
      if (finish) {
        const isEmailTask = /\b(mail|email|send)\b/i.test(this.state.task);
        if (isEmailTask) {
          const visitedEmailService = this.state.actionHistory.some(h => /mail\.google\.com/i.test(h.url || '')) ||
                                     /mail\.google\.com/i.test(pageCtx.url || '');
          const typedInputs = this.state.actionHistory.filter(h => h.toolName === 'type_into_element');
          const clickedActions = this.state.actionHistory.filter(h => h.toolName === 'click_element');

          const hasValidEmailWorkflow = visitedEmailService && (typedInputs.length >= 1 || clickedActions.length >= 2);

          if (!hasValidEmailWorkflow) {
            this._emit('TOOL_ERROR', { error: 'Verification failed: finish_task called before opening Gmail, typing the email, and clicking Send.' });
            this._addUserMessage('SYSTEM REJECTION: You cannot finish this task yet. You have NOT performed the required actions on mail.google.com (navigate to Gmail, type recipient/message, and click Send). You must actually perform these actions on the page before completing.');

            actions = actions.filter(a => a.toolName !== 'finish_task');
            if (!actions.length) {
              if (targetService && !targetService.hostMatch.test(pageCtx.url)) {
                actions = [{
                  toolName: 'open_url',
                  args: { url: targetService.url, rationale: `Navigating to ${targetService.name} to send email.` },
                  callId: this._id()
                }];
              } else {
                actions = [{
                  toolName: 'wait_seconds',
                  args: { seconds: 2, reason: 'Awaiting compose fields or send action' },
                  callId: this._id()
                }];
              }
            }
          }
        }
      }

      // Re-check finish_task after gate
      const verifiedFinish = actions.find(a => a.toolName === 'finish_task');
      if (verifiedFinish) {
        await this._clearCursorAndHighlight();
        const summary = verifiedFinish.args?.summary || 'Task completed.';
        this.state.status = 'COMPLETED';
        this.state.finalSummary = summary;
        this._emit('TASK_COMPLETE', { summary, success: verifiedFinish.args?.success !== false, steps: this.state.stepCount });
        return { success: verifiedFinish.args?.success !== false, summary, steps: this.state.stepCount };
      }

      // Execute actions
      this._emit('STATE_CHANGE', { state: 'ACTING', label: `Step ${this.state.stepCount}: Executing ${actions.map(a => a.toolName).join(' + ')}…` });

      for (const action of actions) {
        if (this.isCancelled) break;

        this._emit('TOOL_CALL', { toolName: action.toolName, args: action.args });

        let observation = '';
        let toolError   = false;

        try {
          this.state.activeTab = await chrome.tabs.get(this.state.activeTab.id);
        } catch (_) {}

        try {
          const result = await executeBrowserTool(
            action.toolName, action.args,
            this.state.activeTab, this.vault
          );
          observation = result.observation || 'Done.';

          if (result.newTabId) {
            try {
              this.state.activeTab = await chrome.tabs.get(result.newTabId);
            } catch (_) {}
          }

          if (result.isFinished) {
            await this._clearCursorAndHighlight();
            this.state.status = 'COMPLETED';
            this.state.finalSummary = result.summary;
            this._emit('TASK_COMPLETE', { summary: result.summary, success: result.success !== false, steps: this.state.stepCount });
            return { success: result.success !== false, summary: result.summary, steps: this.state.stepCount };
          }
        } catch (err) {
          observation = `ERROR: ${err.message}`;
          toolError   = true;
          this._emit('TOOL_ERROR', { error: err.message });
        }

        // ── ERROR RECOVERY & BACKTRACKING HANDLER ──
        if (toolError) {
          this.state.consecutiveFailures++;
          if (action.args?.target_id) {
            this.state.blacklistedTargets.add(Number(action.args.target_id));
          }

          // Strict Backtracking Threshold: consecutiveFailures >= 2
          if (this.state.consecutiveFailures >= 2) {
            this._emit('STATE_CHANGE', {
              state: 'BACKTRACKING',
              label: `🔄 Backtracking: ${this.state.consecutiveFailures} consecutive failures. Reverting and recovering…`
            });

            // If we navigated to a dead-end, revert browser history
            const lastGoodCp = this.state.checkpoints[this.state.checkpoints.length - 1];
            const currentTabUrl = this.state.activeTab?.url || '';

            if (lastGoodCp && lastGoodCp.url !== currentTabUrl) {
              this._emit('STATE_CHANGE', {
                state: 'BACKTRACKING',
                label: `Reverting browser history back to ${lastGoodCp.title || lastGoodCp.url}…`
              });
              try {
                await chrome.tabs.goBack(this.state.activeTab.id);
                await this._sleep(1000);
                this.state.activeTab = await chrome.tabs.get(this.state.activeTab.id);
                observation += `\n[BACKTRACK]: Reverted back to ${this.state.activeTab.url}.`;
              } catch (_) {}
            } else {
              // Try dismissing any modal/overlay with Escape
              try {
                await chrome.tabs.sendMessage(this.state.activeTab.id, {
                  type: 'EXECUTE_ACTION',
                  payload: { action: 'PRESS_ESCAPE' }
                });
              } catch (_) {}
            }

            this._addUserMessage(`🚨 BACKTRACK EXECUTED: Actions failed ${this.state.consecutiveFailures} times consecutively. Element ${JSON.stringify(action.args)} is BLACKLISTED. The browser was stabilized. Analyze the updated DOM table and pick an alternative approach.`);
            this.state.consecutiveFailures = 0;
          }
        } else {
          // Success on action — check for domain drift
          const currentUrl = this.state.activeTab?.url || '';
          if (targetService && !targetService.hostMatch.test(currentUrl) && action.toolName === 'click_element') {
            this._emit('STATE_CHANGE', {
              state: 'BACKTRACKING',
              label: `🚨 Click navigated away from ${targetService.name} to ${currentUrl}. Auto-backtracking with go_back…`
            });
            if (action.args?.target_id) {
              this.state.blacklistedTargets.add(Number(action.args.target_id));
            }
            try {
              await chrome.tabs.goBack(this.state.activeTab.id);
              await this._sleep(1000);
              this.state.activeTab = await chrome.tabs.get(this.state.activeTab.id);
              observation += `\n[BACKTRACK]: Click led away from ${targetService.name}. Reverted back to ${this.state.activeTab.url}. Element #${action.args?.target_id} is blacklisted.`;
            } catch (_) {}
            this._addUserMessage(`🚨 DRIFT DETECTED: Clicking element #${action.args?.target_id} navigated to an unrelated page (${currentUrl}). Browser was automatically navigated back. That element is blacklisted. Pick an on-page control.`);
          } else {
            this.state.consecutiveFailures = 0;
          }
        }

        action.observation = observation;
        this._emit('OBSERVATION', { observation });

        this.state.actionHistory.push({
          toolName: action.toolName,
          args: action.args,
          url: this.state.activeTab?.url || pageCtx.url,
          observation
        });

        // After a click that may open a modal — always re-perceive before continuing
        if (!toolError && action.toolName === 'click_element' && actions.length > 1) {
          await this._sleep(700);
          this._recordTurn([action]);
          break;
        }

        if (actions.length > 1) await this._sleep(200);
      }

      const unrecorded = actions.filter(a => a.observation !== undefined && !a._recorded);
      if (unrecorded.length) this._recordTurn(unrecorded);

      await this._sleep(350);
    }

    await this._clearCursorAndHighlight();

    if (this.isCancelled || this.abortController?.signal?.aborted) {
      this.state.status = 'CANCELLED';
      return { success: false, summary: 'Agent stopped immediately by user.', steps: this.state.stepCount };
    }

    const budgetMsg = `Reached step limit (${this.maxSteps}).`;
    this._emit('BUDGET_REACHED', { summary: budgetMsg });
    return { success: false, summary: budgetMsg, steps: this.state.stepCount };
  }

  // ───────────────────────────────────────────────────────
  // Perceive DOM
  // ───────────────────────────────────────────────────────
  async _perceive() {
    const tabId = this.state.activeTab?.id;
    if (!tabId) return { url: '', title: '', elements: [] };

    try { this.state.activeTab = await chrome.tabs.get(tabId); } catch (_) {}

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('GET_PAGE_CONTEXT timeout')), 5000);
          chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTEXT' }, r => {
            clearTimeout(timer);
            chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r);
          });
        });
        if (resp?.elements) return resp;
      } catch (_) {
        try {
          await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/highlighter.css'] });
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content/dom-actions.js', 'content/content-main.js'] });
          await this._sleep(400);
        } catch (_) {
          break;
        }
      }
    }

    return { url: this.state.activeTab?.url || '', title: this.state.activeTab?.title || '', elements: [] };
  }

  // ───────────────────────────────────────────────────────
  // Mistral reasoning
  // ───────────────────────────────────────────────────────
  async _reasonMistral(pageCtx, targetService) {
    if (this.isCancelled || this.abortController?.signal?.aborted) {
      throw new Error('STOPPED_BY_USER');
    }
    if (!this.apiKey) throw new Error('Mistral API key missing.');

    const systemPrompt = buildSystemPrompt(pageCtx, this.state.stepCount, this.maxSteps, targetService, this.state.sanitizedTask, this.state.blacklistedTargets);
    const messages = [{ role: 'system', content: systemPrompt }, ...this.state.messages];

    let model = this.model || 'mistral-large-latest';

    const call = async (m, msgs) => {
      if (this.isCancelled || this.abortController?.signal?.aborted) {
        throw new Error('STOPPED_BY_USER');
      }
      try {
        return await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          signal: this.abortController?.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: m,
            messages: msgs,
            tools: MISTRAL_TOOL_DECLARATIONS,
            tool_choice: 'auto',
            temperature: 0.1
          })
        });
      } catch (err) {
        if (err.name === 'AbortError' || this.isCancelled || this.abortController?.signal?.aborted) {
          throw new Error('STOPPED_BY_USER');
        }
        throw err;
      }
    };

    let resp = await call(model, messages);

    // Tier fallback: mistral-large-latest → codestral-latest (only if 403 tier limit)
    if (resp.status === 403 && model === 'mistral-large-latest') {
      this._emit('STATE_CHANGE', {
        state: 'REASONING',
        label: 'Mistral API key tier does not allow mistral-large-latest — falling back to codestral-latest…'
      });
      model = 'codestral-latest';
      resp = await call(model, messages);
    }

    // Retry on 429 / 503
    if (resp.status === 429 || resp.status === 503) {
      if (this.isCancelled || this.abortController?.signal?.aborted) throw new Error('STOPPED_BY_USER');
      await this._sleep(2000);
      if (this.isCancelled || this.abortController?.signal?.aborted) throw new Error('STOPPED_BY_USER');
      resp = await call(model, messages);
    }

    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { const j = await resp.json(); msg = j?.message || msg; } catch (_) {}
      throw new Error(`Mistral: ${msg}`);
    }

    const data   = await resp.json();
    const choice = data.choices?.[0]?.message;
    const calls  = choice?.tool_calls || [];
    const thought = choice?.content || '';

    if (calls.length) {
      return {
        actions: calls.map(tc => ({
          toolName: tc.function.name,
          args:     this._parseArgs(tc.function.arguments),
          callId:   tc.id || this._id()
        })),
        thought
      };
    }

    // If model returned text with no tool call and we are on wrong domain, auto-navigate
    if (targetService && !targetService.hostMatch.test(pageCtx.url)) {
      return {
        actions: [{
          toolName: 'open_url',
          args: { url: targetService.url, rationale: `Navigating to ${targetService.name} to fulfill user request.` },
          callId: this._id()
        }],
        thought: thought || `Navigating to ${targetService.name} (${targetService.url})…`
      };
    }

    // Nudge model to return a tool call
    const nudgeMessages = [
      ...messages,
      { role: 'assistant', content: thought || 'Thinking about next action...' },
      { role: 'user', content: `[SYSTEM ALERT]: You replied with text only without calling a tool. You MUST call an available tool to interact with the browser. Target task: "${this.state.sanitizedTask}". Current page: ${pageCtx.url}. Return a tool call now.` }
    ];

    const retryResp = await call(model, nudgeMessages);
    if (retryResp.ok) {
      const retryData = await retryResp.json();
      const retryChoice = retryData.choices?.[0]?.message;
      const retryCalls = retryChoice?.tool_calls || [];
      if (retryCalls.length) {
        return {
          actions: retryCalls.map(tc => ({
            toolName: tc.function.name,
            args:     this._parseArgs(tc.function.arguments),
            callId:   tc.id || this._id()
          })),
          thought: retryChoice?.content || thought
        };
      }
    }

    return this._fallbackAction(thought);
  }

  // ───────────────────────────────────────────────────────
  // Gemini reasoning
  // ───────────────────────────────────────────────────────
  async _reasonGemini(pageCtx, targetService) {
    if (this.isCancelled || this.abortController?.signal?.aborted) {
      throw new Error('STOPPED_BY_USER');
    }
    if (!this.apiKey) throw new Error('Gemini API key missing.');

    let model = this.model || 'gemini-3.8-flash';
    if (/gemini-2\.0/.test(model)) model = 'gemini-3.8-flash';

    const systemPrompt = buildSystemPrompt(pageCtx, this.state.stepCount, this.maxSteps, targetService, this.state.sanitizedTask, this.state.blacklistedTargets);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    let resp;
    for (let i = 0; i < 3; i++) {
      if (this.isCancelled || this.abortController?.signal?.aborted) {
        throw new Error('STOPPED_BY_USER');
      }
      try {
        resp = await fetch(url, {
          method: 'POST',
          signal: this.abortController?.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: this.state.messages,
            tools: [{ functionDeclarations: BROWSER_TOOL_DECLARATIONS }],
            generationConfig: { temperature: 0.1 }
          })
        });
      } catch (err) {
        if (err.name === 'AbortError' || this.isCancelled || this.abortController?.signal?.aborted) {
          throw new Error('STOPPED_BY_USER');
        }
        throw err;
      }
      if (resp.ok || (resp.status !== 429 && resp.status !== 503)) break;
      await this._sleep((i + 1) * 1500);
    }

    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { const j = await resp.json(); msg = j?.error?.message || msg; } catch (_) {}
      throw new Error(`Gemini: ${msg}`);
    }

    const data    = await resp.json();
    const parts   = data.candidates?.[0]?.content?.parts || [];
    const fnParts = parts.filter(p => p.functionCall);
    const thought = parts.find(p => p.text)?.text || '';

    if (fnParts.length) {
      return {
        actions: fnParts.map(p => ({
          toolName: p.functionCall.name,
          args:     this._coerceIds(p.functionCall.args || {}),
          callId:   this._id()
        })),
        thought
      };
    }

    if (targetService && !targetService.hostMatch.test(pageCtx.url)) {
      return {
        actions: [{
          toolName: 'open_url',
          args: { url: targetService.url, rationale: `Navigating to ${targetService.name} to fulfill user request.` },
          callId: this._id()
        }],
        thought: thought || `Navigating to ${targetService.name} (${targetService.url})…`
      };
    }

    return this._fallbackAction(thought);
  }

  // ───────────────────────────────────────────────────────
  // Conversation memory helpers
  // ───────────────────────────────────────────────────────
  _addUserMessage(text) {
    if (this.provider === 'mistral') {
      this.state.messages.push({ role: 'user', content: text });
    } else {
      this.state.messages.push({ role: 'user', parts: [{ text }] });
    }
  }

  _recordTurn(actions) {
    actions.forEach(a => { a._recorded = true; });

    if (this.provider === 'mistral') {
      this.state.messages.push({
        role: 'assistant',
        content: null,
        tool_calls: actions.map(a => ({
          id:       a.callId,
          type:     'function',
          function: { name: a.toolName, arguments: JSON.stringify(a.args) }
        }))
      });
      for (const a of actions) {
        this.state.messages.push({
          role:         'tool',
          tool_call_id: a.callId,
          name:         a.toolName,
          content:      a.observation || 'Done.'
        });
      }
    } else {
      this.state.messages.push({
        role:  'model',
        parts: actions.map(a => ({ functionCall: { name: a.toolName, args: a.args } }))
      });
      for (const a of actions) {
        this.state.messages.push({
          role:  'function',
          parts: [{ functionResponse: { name: a.toolName, response: { output: a.observation || 'Done.' } } }]
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────
  // Utilities
  // ───────────────────────────────────────────────────────
  _parseArgs(raw) {
    try {
      const args = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      return this._coerceIds(args);
    } catch (_) { return {}; }
  }

  _coerceIds(args) {
    if (args.target_id !== undefined && typeof args.target_id !== 'number') {
      args.target_id = parseInt(String(args.target_id), 10);
    }
    return args;
  }

  _fallbackAction(thought) {
    return {
      actions: [{ toolName: 'wait_seconds', args: { seconds: 2, reason: 'Scanning DOM for interactive elements' }, callId: this._id() }],
      thought: thought || 'Analyzing page…'
    };
  }

  _id() { return `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
  _sleep(ms) {
    if (this.isCancelled || this.abortController?.signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let timer = null;
      const onAbort = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      if (this.abortController?.signal) {
        if (this.abortController.signal.aborted) {
          return resolve();
        }
        this.abortController.signal.addEventListener('abort', onAbort, { once: true });
      }
      timer = setTimeout(() => {
        if (this.abortController?.signal) {
          this.abortController.signal.removeEventListener('abort', onAbort);
        }
        resolve();
      }, ms);
    });
  }
}
