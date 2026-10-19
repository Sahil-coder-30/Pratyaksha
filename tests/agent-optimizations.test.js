/**
 * PRATYAKSHA Test Suite: Agent Reliability Optimizations
 * Covers context windowing, action log memory, loop detection, compact page
 * observation, approval interrupt/resume, navigation batch guard, and
 * verifier feedback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { MemorySaver, Command } from '@langchain/langgraph';
import {
  buildModelHistory,
  extractActionHistory,
  buildActionLog,
  detectLoop,
  getMessageType
} from '../src/agent/middleware.js';
import { buildPageObservation, formatElementLine } from '../src/browser/page-context.js';
import { createAgentGraph } from '../src/agent/graph.js';
import { verifierNode } from '../src/agent/verifier.js';
import { createMockChrome } from './helpers/mock-chrome.js';

function turn(id, name, args, result) {
  return [
    new AIMessage({ content: '', tool_calls: [{ id, name, args }] }),
    new ToolMessage({ tool_call_id: id, name, content: result })
  ];
}

test('Context - buildModelHistory keeps only recent turns and pairs every tool call', () => {
  const messages = [];
  for (let i = 1; i <= 10; i++) {
    messages.push(...turn(`c${i}`, 'click_element', { target_id: i }, `Clicked [${i}] ` + 'x'.repeat(5000)));
  }
  // Dangling tool call without a result
  messages.push(new AIMessage({ content: '', tool_calls: [{ id: 'dangling', name: 'scroll_page', args: { direction: 'down' } }] }));

  const window = buildModelHistory(messages, { maxTurns: 3 });
  const aiCount = window.filter(m => getMessageType(m) === 'ai').length;
  assert.equal(aiCount, 3, 'only the last 3 AI turns are sent');
  assert.equal(getMessageType(window[0]), 'ai', 'window never starts with an orphan tool message');

  const toolIds = window.filter(m => getMessageType(m) === 'tool').map(m => m.tool_call_id);
  assert.ok(toolIds.includes('dangling'), 'missing tool result is synthesized');

  const longest = Math.max(...window.filter(m => getMessageType(m) === 'tool').map(m => m.content.length));
  assert.ok(longest < 3000, 'observations are truncated');
});

test('Memory - action history, compact log and loop detection', () => {
  const messages = [
    ...turn('a', 'open_url', { url: 'https://example.com' }, 'Opened: https://example.com'),
    ...turn('b', 'click_element', { target_id: 4 }, 'ERROR [click_element]: Element [4] no longer exists'),
    ...turn('c', 'click_element', { target_id: 4 }, 'ERROR [click_element]: Element [4] no longer exists'),
    ...turn('d', 'click_element', { target_id: 4 }, 'ERROR [click_element]: Element [4] no longer exists')
  ];

  const history = extractActionHistory(messages);
  assert.equal(history.length, 4);
  assert.equal(history[0].ok, true);
  assert.equal(history[0].url, 'https://example.com');
  assert.equal(history[1].ok, false);
  assert.deepEqual(history[1].args, { target_id: 4 });

  const log = buildActionLog(history);
  assert.ok(log.includes('1. open_url'));
  assert.ok(log.includes('FAILED'));

  const warning = detectLoop(history);
  assert.ok(warning.includes('repeated the same click_element'));
  assert.equal(detectLoop(history.slice(0, 2)), '');
});

test('Perception - compact element lines mark new, dialog and state', () => {
  const line = formatElementLine({ id: 12, tag: 'button', label: 'Send', isNew: true, inDialog: true, disabled: true });
  assert.equal(line, '*[12] <button> "Send" (disabled, dialog)');

  const obs = buildPageObservation({
    elements: [
      { id: 1, tag: 'input', type: 'search', label: 'Search', value: 'cats', inViewport: true },
      { id: 2, tag: 'a', label: 'Next page', href: '/page/2', inViewport: false },
      { id: 3, tag: 'select', label: 'Country', options: ['India', 'USA'], value: 'India', inViewport: true }
    ],
    page: { pixelsAbove: 0, pixelsBelow: 1200, dialogOpen: true, dialogLabel: 'Compose', visibleText: 'Hello world' }
  });

  assert.ok(obs.includes('at top, 1200px more below'));
  assert.ok(obs.includes('dialog/modal is open ("Compose")'));
  assert.ok(obs.includes('[1] <input type=search> "Search" value="cats"'));
  assert.ok(obs.includes('options=[India | USA]'));
  assert.ok(obs.indexOf('[3]') < obs.indexOf('below/above the viewport'), 'viewport elements come first');
  assert.ok(obs.includes('→ /page/2'));
  assert.ok(obs.includes('VISIBLE TEXT'));
});

test('Approval - irreversible click pauses via interrupt and resumes without re-calling the LLM', async () => {
  const chromeApi = createMockChrome();
  let llmCalls = 0;
  const model = {
    bindTools() {
      return {
        async invoke() {
          llmCalls++;
          if (llmCalls === 1) {
            return new AIMessage({
              content: '',
              tool_calls: [{ id: 'send_1', name: 'click_element', args: { target_id: 9, semantic_hint: 'Send' } }]
            });
          }
          return new AIMessage({
            content: '',
            tool_calls: [{ id: 'fin_1', name: 'finish_task', args: { summary: 'Message sent', success: true } }]
          });
        }
      };
    }
  };

  const app = createAgentGraph({ model, chromeApi, checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: 'approval_thread' }, recursionLimit: 100 };

  const paused = await app.invoke({
    originalTask: 'Click send on the open form',
    browserSession: { tabId: 1, url: 'https://example.com', title: 'Example' }
  }, config);

  assert.ok(Array.isArray(paused.__interrupt__) && paused.__interrupt__.length === 1, 'graph paused on approval');
  assert.equal(paused.__interrupt__[0].value.type, 'TOOL_APPROVAL_REQUIRED');
  assert.ok(paused.__interrupt__[0].value.request.token);
  assert.equal(llmCalls, 1);

  const clicksBefore = chromeApi._state.messagesSent.filter(m => m.message?.payload?.action === 'CLICK').length;
  assert.equal(clicksBefore, 0, 'nothing clicked before approval');

  const done = await app.invoke(new Command({ resume: { approved: true } }), config);
  const clicksAfter = chromeApi._state.messagesSent.filter(m => m.message?.payload?.action === 'CLICK').length;

  assert.equal(clicksAfter, 1, 'approved click executed exactly once');
  assert.equal(llmCalls, 2, 'resume did not repeat the first LLM call');
  assert.equal(done.status, 'COMPLETED');
  assert.ok(done.finalResult.summary.includes('Message sent'));
});

test('Batch guard - remaining tool calls are skipped after the page navigates', async () => {
  const chromeApi = createMockChrome();
  let llmCalls = 0;
  const model = {
    bindTools() {
      return {
        async invoke() {
          llmCalls++;
          if (llmCalls === 1) {
            return new AIMessage({
              content: '',
              tool_calls: [
                { id: 'nav', name: 'open_url', args: { url: 'https://example.org/next' } },
                { id: 'stale', name: 'click_element', args: { target_id: 3 } }
              ]
            });
          }
          return new AIMessage({
            content: '',
            tool_calls: [{ id: 'fin', name: 'finish_task', args: { summary: 'Done', success: true } }]
          });
        }
      };
    }
  };

  const app = createAgentGraph({ model, chromeApi, enableInterrupts: false });
  const res = await app.invoke({
    originalTask: 'Open the next page',
    browserSession: { tabId: 1, url: 'https://example.com', title: 'Example' }
  });

  const skipped = res.messages.find(m => getMessageType(m) === 'tool' && m.tool_call_id === 'stale');
  assert.ok(skipped.content.startsWith('SKIPPED'), 'stale click after navigation was skipped');
  const clicks = chromeApi._state.messagesSent.filter(m => m.message?.payload?.action === 'CLICK').length;
  assert.equal(clicks, 0);
  assert.equal(res.status, 'COMPLETED');
});

test('Verifier - rejected completion tells the model why', async () => {
  const update = await verifierNode({
    originalTask: 'Send an email to boss@example.com about the report',
    browserSession: { url: 'https://example.com' },
    messages: [],
    latestObservation: { isFinished: true, success: true, summary: 'Email sent' }
  });

  assert.equal(update.status, 'RECOVERABLE');
  assert.equal(update.latestObservation, null);
  assert.ok(update.messages[0] instanceof HumanMessage);
  assert.ok(update.messages[0].content.includes('rejected by verification'));
});

test('Verifier - explicit give-up keeps the agent explanation', async () => {
  const update = await verifierNode({
    originalTask: 'Log in and download my invoice',
    browserSession: { url: 'https://example.com/login' },
    messages: [],
    latestObservation: { isFinished: true, success: false, summary: 'Login required: no credentials were provided.' }
  });
  assert.equal(update.status, 'FAILED');
  assert.ok(update.verificationResult.reason.includes('Login required'));
});

test('Text-only replies - nudged once, accepted as the answer on the second turn', async () => {
  const chromeApi = createMockChrome();
  let calls = 0;
  let nudged = false;
  const model = {
    bindTools() {
      return {
        async invoke(msgs) {
          calls++;
          const last = msgs[msgs.length - 1];
          if (calls === 2 && getMessageType(last) === 'human' && /without calling a tool/.test(last.content)) nudged = true;
          return new AIMessage({ content: 'Hello! I can browse websites for you.' });
        }
      };
    }
  };

  const app = createAgentGraph({ model, chromeApi, enableInterrupts: false });
  const res = await app.invoke({
    originalTask: 'hello',
    browserSession: { tabId: 1, url: 'https://example.com', title: 'Example' }
  });

  assert.equal(calls, 2);
  assert.ok(nudged, 'second call received a nudge to use tools');
  assert.equal(res.status, 'COMPLETED');
  assert.ok(res.finalResult.summary.includes('browse websites'));
});

test('Runner - interrupt result becomes an approval request and resumes with Command', async () => {
  const { PratyakshaAgentRunner } = await import('../src/runner.js');
  const { createApprovalRequest } = await import('../src/safety/approval.js');
  const { AGENT_EVENT_TYPES } = await import('../src/ui/agent-events.js');

  const events = [];
  const runner = new PratyakshaAgentRunner({ chromeApi: createMockChrome(), onEvent: ev => events.push(ev) });
  runner.activeThreadId = 'th_interrupt';
  runner.activeTab = { id: 1, url: 'https://start.example.com', title: 'Start' };

  // Request created on a different page than the run started on
  const request = createApprovalRequest({
    threadId: 'th_interrupt',
    action: { toolName: 'click_element', args: { target_id: 9, semantic_hint: 'Send' } },
    reason: 'Irreversible click',
    pageContext: { url: 'https://mail.example.com/compose', title: 'Compose' }
  });

  const handled = await runner._handleResult({
    __interrupt__: [{ id: 'i1', value: { type: 'TOOL_APPROVAL_REQUIRED', request } }],
    stepCount: 3
  }, 'th_interrupt');

  assert.equal(handled.awaitingApproval, true);
  assert.ok(events.some(e => e.type === AGENT_EVENT_TYPES.APPROVAL_REQUIRED));

  let resumedWith = null;
  runner.app = {
    async invoke(input) {
      resumedWith = input;
      return { status: 'COMPLETED', finalResult: { success: true, summary: 'Sent', steps: 4 } };
    }
  };
  runner.graphConfig = { configurable: { thread_id: 'th_interrupt' } };

  const result = await runner.approveAction(request.token);
  assert.ok(resumedWith instanceof Command, 'resumed through Command, not a fresh invoke');
  assert.equal(resumedWith.resume.approved, true);
  assert.equal(result.success, true);
});
