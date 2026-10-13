/**
 * PRATYAKSHA Test Suite: LangChain Browser Tool Adapters
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLangChainBrowserTools } from '../src/agent/browser-tools.js';
import { createMockChrome } from './helpers/mock-chrome.js';
import { TOOL_NAMES } from '../src/shared/constants.js';

test('LangChain Tool Adapter - Creates Complete Tool Suite', () => {
  const mockSession = {
    activeTab: { id: 1, url: 'https://example.com', title: 'Example' },
    chromeApi: createMockChrome()
  };

  const tools = createLangChainBrowserTools(() => mockSession);
  assert.equal(tools.length, 19, 'Must generate all 19 LangChain tools');

  for (const t of tools) {
    assert.ok(t.name);
    assert.ok(t.description);
    assert.equal(typeof t.invoke, 'function');
  }

  // Without finish_task
  const toolsWithoutFinish = createLangChainBrowserTools(() => mockSession, { includeFinishTask: false });
  assert.equal(toolsWithoutFinish.length, 18);
  assert.equal(toolsWithoutFinish.some(t => t.name === TOOL_NAMES.FINISH_TASK), false);
});

test('LangChain Tool Adapter - Invocation & Observation Flow', async () => {
  const chromeApi = createMockChrome();
  const session = {
    activeTab: { id: 1, url: 'https://example.com', title: 'Example' },
    chromeApi,
    capturedResults: []
  };
  session.onToolResult = (r) => session.capturedResults.push(r);

  const tools = createLangChainBrowserTools(() => session);
  const openUrlTool = tools.find(t => t.name === TOOL_NAMES.OPEN_URL);
  assert.ok(openUrlTool);

  const observation = await openUrlTool.invoke({
    url: 'https://news.ycombinator.com',
    rationale: 'check tech news'
  });

  assert.ok(observation.includes('Opened: https://news.ycombinator.com'));
  assert.equal(session.capturedResults.length, 1);
  assert.equal(session.capturedResults[0].toolName, TOOL_NAMES.OPEN_URL);
  assert.equal(session.capturedResults[0].ok, true);
});

test('LangChain Tool Adapter - Tab Switching Updates Session Tab ID', async () => {
  const chromeApi = createMockChrome({
    tabs: [
      { id: 1, windowId: 1, url: 'https://google.com', title: 'Google', active: true },
      { id: 42, windowId: 1, url: 'https://mail.google.com', title: 'Gmail Inbox', active: false }
    ]
  });

  const session = {
    activeTab: { id: 1, url: 'https://google.com', title: 'Google' },
    chromeApi
  };

  const tools = createLangChainBrowserTools(() => session);
  const switchTabTool = tools.find(t => t.name === TOOL_NAMES.SWITCH_TAB);

  const observation = await switchTabTool.invoke({ title_contains: 'Gmail' });
  assert.ok(observation.includes('Gmail Inbox'));
  assert.equal(session.activeTab.id, 42, 'Session active tab ID must be updated');
});
