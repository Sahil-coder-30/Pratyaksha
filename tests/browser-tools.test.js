/**
 * PRATYAKSHA Test Suite: Browser Execution Layer Hardening
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBrowserTool, isForbiddenUrl } from '../src/browser/browser-tools.js';
import { detectTargetService, buildDOMTable } from '../src/browser/page-context.js';
import { createMockChrome } from './helpers/mock-chrome.js';
import { TOOL_NAMES } from '../src/shared/constants.js';

test('URL Policy - Forbidden Protocol Checks', () => {
  assert.equal(isForbiddenUrl('chrome://settings'), true);
  assert.equal(isForbiddenUrl('chrome-extension://abc/page.html'), true);
  assert.equal(isForbiddenUrl('about:blank'), true);
  assert.equal(isForbiddenUrl('javascript:alert(1)'), true);
  assert.equal(isForbiddenUrl('data:text/html,test'), true);
  assert.equal(isForbiddenUrl('https://mail.google.com'), false);
  assert.equal(isForbiddenUrl('http://localhost:3000'), false);
});

test('Browser Tools - open_url Success & Forbidden Blocking', async () => {
  const chromeApi = createMockChrome();
  const activeTab = { id: 1, url: 'https://example.com', title: 'Example' };

  // Valid navigation
  const validRes = await executeBrowserTool(
    TOOL_NAMES.OPEN_URL,
    { url: 'https://wikipedia.org', rationale: 'research' },
    activeTab,
    { chromeApi }
  );

  assert.equal(validRes.ok, true);
  assert.ok(validRes.observation.includes('Opened: https://wikipedia.org'));
  assert.equal(validRes.error, null);

  // Forbidden navigation blocked
  const blockedRes = await executeBrowserTool(
    TOOL_NAMES.OPEN_URL,
    { url: 'chrome://settings' },
    activeTab,
    { chromeApi }
  );

  assert.equal(blockedRes.ok, false);
  assert.equal(blockedRes.error.code, 'POLICY_VIOLATION');
  assert.equal(blockedRes.error.recoverable, false);
});

test('Browser Tools - type_into_element with Local Vault Rehydration', async () => {
  const chromeApi = createMockChrome();
  const activeTab = { id: 1, url: 'https://example.com/form', title: 'Form' };

  const mockVault = {
    rehydrate: (text) => text.replace('[EMAIL_1234]', 'user@example.com')
  };

  chromeApi._setNextMessageResponse({ success: true });

  const res = await executeBrowserTool(
    TOOL_NAMES.TYPE_INTO_ELEMENT,
    { target_id: 10, text: 'Hello [EMAIL_1234]', press_enter: true },
    activeTab,
    { chromeApi, vault: mockVault }
  );

  assert.equal(res.ok, true);
  assert.ok(res.observation.includes('[#10] + Enter'));

  // Verify rehydrated value was sent to content script
  const sentMsgs = chromeApi._state.messagesSent;
  const typeMsg = sentMsgs.find(m => m.message?.payload?.action === 'TYPE');
  assert.ok(typeMsg);
  assert.equal(typeMsg.message.payload.value, 'Hello user@example.com');
});

test('Browser Tools - switch_tab by Keyword', async () => {
  const chromeApi = createMockChrome({
    tabs: [
      { id: 1, windowId: 1, url: 'https://google.com', title: 'Google', active: true },
      { id: 2, windowId: 1, url: 'https://github.com/repo', title: 'GitHub Repo', active: false }
    ]
  });

  const activeTab = { id: 1, url: 'https://google.com', title: 'Google' };

  const res = await executeBrowserTool(
    TOOL_NAMES.SWITCH_TAB,
    { title_contains: 'github' },
    activeTab,
    { chromeApi }
  );

  assert.equal(res.ok, true);
  assert.equal(res.newTabId, 2);
  assert.ok(res.observation.includes('GitHub Repo'));
});

test('Browser Tools - screenshot Preserves Multimodal Data', async () => {
  const chromeApi = createMockChrome();
  const activeTab = { id: 1, url: 'https://example.com', title: 'Example' };

  const res = await executeBrowserTool(
    TOOL_NAMES.SCREENSHOT,
    {},
    activeTab,
    { chromeApi }
  );

  assert.equal(res.ok, true);
  assert.ok(res.screenshotDataUrl.startsWith('data:image/png;base64,'));
  assert.ok(res.observation.includes('Screenshot captured'));
});

test('Browser Tools - Cancellation Aborts Operation', async () => {
  const chromeApi = createMockChrome();
  const activeTab = { id: 1, url: 'https://example.com', title: 'Example' };
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(async () => {
    await executeBrowserTool(
      TOOL_NAMES.WAIT_SECONDS,
      { seconds: 2 },
      activeTab,
      { chromeApi, signal: controller.signal }
    );
  }, {
    name: 'PratyakshaError',
    code: 'CANCELLED'
  });
});

test('Page Context - Target Service Detection', () => {
  const s1 = detectTargetService('Check my latest emails on Gmail');
  assert.ok(s1);
  assert.equal(s1.name, 'Gmail');
  assert.equal(s1.url, 'https://mail.google.com');

  const s2 = detectTargetService('Go to https://news.ycombinator.com/item?id=123');
  assert.ok(s2);
  assert.equal(s2.name, 'news.ycombinator.com');

  const s3 = detectTargetService('Search for best chocolate cakes');
  assert.equal(s3, null);
});

test('Page Context - buildDOMTable with Target Blacklisting', () => {
  const elements = [
    { id: 1, tag: 'button', type: 'submit', label: 'Submit Application' },
    { id: 2, tag: 'input', type: 'text', label: 'Email', value: '' },
    { id: 3, tag: 'a', role: 'link', text: 'Dead Link' }
  ];

  const blacklisted = new Set([3]);
  const table = buildDOMTable(elements, 75, blacklisted);

  assert.ok(table.includes('Email'));
  assert.ok(table.includes('Submit Application'));
  assert.ok(table.includes('[FAILED/DO-NOT-USE] Dead Link'));
  assert.ok(table.includes('⚠️ BLACKLISTED'));
});
