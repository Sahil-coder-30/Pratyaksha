/**
 * PRATYAKSHA Side Panel Controller — Minimal Chat Interface
 */

import { globalVault } from '../vault/pii-vault.js';
import { getEffectiveConfig } from '../env.js';
import { LangGraphAgent } from '../agent/graph-engine.js';

let activeTab = null;
let pageContext = null;
let isExecuting = false;
let activeAgent = null;

// DOM Elements — Header
const settingsBtn = document.getElementById('settingsBtn');

// DOM Elements — Chat Area
const chatContainer = document.getElementById('chatContainer');
const chatMessages = document.getElementById('chatMessages');

// DOM Elements — Bottom Input Dock
const promptInput = document.getElementById('promptInput');
const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');

// DOM Elements — Drawers & Modals
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const engineSelect = document.getElementById('engineSelect');
const mistralGroup = document.getElementById('mistralGroup');
const mistralApiKey = document.getElementById('mistralApiKey');
const mistralModel = document.getElementById('mistralModel');
const geminiKeyGroup = document.getElementById('geminiKeyGroup');
const geminiModelGroup = document.getElementById('geminiModelGroup');
const geminiApiKey = document.getElementById('geminiApiKey');
const geminiModel = document.getElementById('geminiModel');
const privacyLevel = document.getElementById('privacyLevel');

// Active Message State
let currentAgentMessageEl = null;
let currentAnswerBubbleEl = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await refreshActiveTab();
  setupEventListeners();
});

// Setup event handlers
function setupEventListeners() {
  // Emergency Stop Button (1-Click Immediate Halt & Abort)
  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      log('🛑 Stop requested: halting agent immediately…', 'warn');
      if (activeAgent) {
        activeAgent.cancel();
      }

      // 1-Click Instant UI restore (0ms latency, zero extra token burn)
      setBusyState(false);

      // Instantly clear element highlights on the inspected webpage
      if (activeTab?.id) {
        chrome.tabs.sendMessage(activeTab.id, { type: 'CLEAR_HIGHLIGHT' }).catch(() => {});
      }

      if (currentAgentMessageEl) {
        const activity = currentAgentMessageEl.querySelector('.agent-activity');
        if (activity) activity.remove();
        if (currentAnswerBubbleEl) {
          currentAnswerBubbleEl.style.display = 'block';
          currentAnswerBubbleEl.textContent = 'Stopped.';
        }
      }
      log('🛑 Agent halted. In-flight requests aborted & DOM highlights cleared.', 'success');
    });
  }

  // Run Button
  if (runBtn) runBtn.addEventListener('click', handleRunPrompt);

  // Textarea dynamic sizing & Enter to submit
  if (promptInput) {
    promptInput.addEventListener('input', () => {
      promptInput.style.height = 'auto';
      promptInput.style.height = Math.min(promptInput.scrollHeight, 100) + 'px';
    });

    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleRunPrompt();
      }
    });
  }

  // Settings Modal
  if (settingsBtn) settingsBtn.addEventListener('click', () => settingsModal.style.display = 'flex');
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => settingsModal.style.display = 'none');
  if (engineSelect) {
    engineSelect.addEventListener('change', () => {
      const val = engineSelect.value;
      if (mistralGroup) mistralGroup.style.display = val === 'mistral' ? 'flex' : 'none';
      if (geminiKeyGroup) geminiKeyGroup.style.display = val === 'gemini' ? 'flex' : 'none';
      if (geminiModelGroup) geminiModelGroup.style.display = val === 'gemini' ? 'flex' : 'none';
    });
  }
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);

  // Tab change listener from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TAB_CHANGED') {
      refreshActiveTab();
    }
  });
}

// Internal trace events are intentionally not rendered in the customer UI.
function log() {}

// Load user settings
async function loadSettings() {
  const config = await getEffectiveConfig();
  const data = await chrome.storage.local.get([
    'engineMode', 'provider', 'mistralApiKey', 'mistralModel',
    'geminiApiKey', 'geminiModel', 'privacyMode', 'autonomousMode'
  ]);

  const provider = data.provider || config.provider || 'mistral';
  if (engineSelect) engineSelect.value = provider;

  if (mistralGroup) mistralGroup.style.display = provider === 'mistral' ? 'flex' : 'none';
  if (geminiKeyGroup) geminiKeyGroup.style.display = provider === 'gemini' ? 'flex' : 'none';
  if (geminiModelGroup) geminiModelGroup.style.display = provider === 'gemini' ? 'flex' : 'none';

  if (mistralApiKey) mistralApiKey.value = data.mistralApiKey || config.mistralApiKey || '';
  if (mistralModel) mistralModel.value = data.mistralModel || config.mistralModel || 'mistral-large-latest';

  let activeGeminiModel = data.geminiModel || config.geminiModel || 'gemini-3.8-flash';
  if (activeGeminiModel === 'gemini-2.0-flash' || activeGeminiModel === 'gemini-2.0-flash-lite') {
    activeGeminiModel = 'gemini-3.8-flash';
  }
  if (geminiApiKey) geminiApiKey.value = data.geminiApiKey || config.geminiApiKey || '';
  if (geminiModel) geminiModel.value = activeGeminiModel;
  if (data.privacyMode && privacyLevel) privacyLevel.value = data.privacyMode;

  if (!data.mistralApiKey && config.mistralApiKey) {
    await chrome.storage.local.set({
      mistralApiKey: config.mistralApiKey,
      mistralModel: config.mistralModel || 'mistral-large-latest',
      provider: 'mistral'
    });
    log('🔑 Auto-detected Mistral Agent API key from environment config.', 'info');
  }
}

// Save user settings
async function saveSettings() {
  const provider = engineSelect ? engineSelect.value : 'mistral';
  await chrome.storage.local.set({
    provider,
    engineMode: provider,
    mistralApiKey: mistralApiKey ? mistralApiKey.value.trim() : '',
    mistralModel: mistralModel ? mistralModel.value : 'mistral-large-latest',
    geminiApiKey: geminiApiKey ? geminiApiKey.value.trim() : '',
    geminiModel: geminiModel ? geminiModel.value : 'gemini-3.8-flash',
    privacyMode: privacyLevel ? privacyLevel.value : 'strict'
  });

  if (settingsModal) settingsModal.style.display = 'none';
  log(`Settings updated. Active provider: ${provider.toUpperCase()}`, 'info');
}

// Refresh active tab and verify content script injection
async function refreshActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;

    activeTab = tabs[0];
    const url = activeTab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      log('Cannot execute on internal Chrome pages (chrome://). Please navigate to an HTTP/HTTPS site.', 'warn');
      return;
    }

    // Ensure content script is ready
    await chrome.runtime.sendMessage({
      type: 'ENSURE_CONTENT_SCRIPT',
      tabId: activeTab.id
    });

    await scanCurrentPage();
  } catch (err) {
    console.error('[PRATYAKSHA] Tab refresh error:', err);
    log(`Tab connection warning: ${err.message}`, 'warn');
  }
}

async function scanCurrentPage() {
  if (!activeTab || !activeTab.id) return;

  const tryGetContext = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('GET_PAGE_CONTEXT timeout')), 4000);
    chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_CONTEXT' }, resp => {
      clearTimeout(timer);
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(resp);
    });
  });

  let response;
  try {
    response = await tryGetContext();
  } catch (_) {
    try {
      await chrome.runtime.sendMessage({ type: 'ENSURE_CONTENT_SCRIPT', tabId: activeTab.id });
      await new Promise(r => setTimeout(r, 400));
      response = await tryGetContext();
    } catch (err2) {
      return;
    }
  }

  if (response && response.elements) {
    pageContext = response;
    let hostname = 'page';
    try { hostname = new URL(response.url).hostname; } catch (_) {}
    log(`DOM Indexed: Found ${response.elements.length} actionable elements on ${hostname}`, 'info');
  }
}

// Main execution handler
async function handleRunPrompt() {
  const rawPrompt = promptInput.value.trim();
  if (!rawPrompt) {
    promptInput.focus();
    return;
  }

  if (isExecuting) {
    log('Agent is currently executing a task. Click Stop to cancel.', 'warn');
    return;
  }

  // Clear input box
  promptInput.value = '';
  promptInput.style.height = 'auto';

  // The welcome state belongs only to the empty conversation.
  document.getElementById('welcomeScreen')?.remove();

  // 1. Render User Message Bubble
  renderUserMessage(rawPrompt);

  // 2. Show a quiet activity state while the agent works.
  createAgentMessageSlot();

  setBusyState(true);
  log(`User Request: "${rawPrompt}"`, 'info');

  try {
    {
      const config = await getEffectiveConfig();
      const settings = await chrome.storage.local.get([
        'provider', 'mistralApiKey', 'mistralModel', 'geminiApiKey', 'geminiModel'
      ]);

      const provider = settings.provider || config.provider || 'mistral';
      const apiKey = provider === 'mistral'
        ? (settings.mistralApiKey || config.mistralApiKey || '').trim()
        : (settings.geminiApiKey || config.geminiApiKey || '').trim();

      const model = provider === 'mistral'
        ? (settings.mistralModel || config.mistralModel || 'mistral-large-latest')
        : (settings.geminiModel || config.geminiModel || 'gemini-3.8-flash');

      if (!apiKey) {
        throw new Error(`${provider === 'mistral' ? 'Mistral' : 'Gemini'} API Key is missing. Click ⚙ Settings to configure.`);
      }

      activeAgent = new LangGraphAgent({
        provider,
        apiKey,
        model,
        vault: globalVault,
        maxSteps: 20,
        onEvent: handleAgentEvent
      });

      const result = await activeAgent.run(rawPrompt, activeTab);
      if (activeAgent?.isCancelled) {
        // Stopped cleanly via 1-click stopBtn handler
        return;
      }
      if (result.success) {
        log(`🎉 Autonomous Task Completed in ${result.steps} step(s)!`, 'success');
        finishAgentMessage(result.summary || 'Task completed successfully.');
      } else {
        log(`Task ended: ${result.summary}`, 'warn');
        finishAgentMessage(result.summary || 'Task finished without completion.', false);
      }
    }
  } catch (err) {
    if (activeAgent?.isCancelled || err.message === 'STOPPED_BY_USER') {
      // Clean stop — already handled in 1-click stopBtn event
      return;
    }
    log(`[ERROR] ${err.message}`, 'error');
    finishAgentMessage(`❌ Error: ${err.message}`, false);
  } finally {
    setBusyState(false);
    setTimeout(() => { activeAgent = null; }, 300);
  }
}

// ── Chat Rendering Functions ─────────────────────────────────

function renderUserMessage(text) {
  const row = document.createElement('div');
  row.className = 'chat-row user';
  row.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(row);
  scrollToBottom();
}

function createAgentMessageSlot() {
  const msgId = Date.now();
  const row = document.createElement('div');
  row.className = 'chat-row agent';
  row.id = `msg-${msgId}`;
  row.innerHTML = `<div class="agent-activity" role="status" aria-label="Working"><span class="activity-spinner"></span></div><div class="agent-answer-bubble" id="answer-${msgId}" style="display:none;"></div>`;

  chatMessages.appendChild(row);

  currentAgentMessageEl = row;
  currentAnswerBubbleEl = row.querySelector(`#answer-${msgId}`);

  scrollToBottom();
}

function handleAgentEvent(event) {
  switch (event.type) {
    case 'TASK_COMPLETE':
      finishAgentMessage(event.summary, true);
      break;

    case 'BUDGET_REACHED':
      finishAgentMessage(event.summary, false);
      break;

    case 'CANCELLED':
      finishAgentMessage(event.message || 'Execution cancelled by user.', false);
      break;
  }
}

function finishAgentMessage(summaryText, isSuccess = true) {
  if (currentAgentMessageEl) {
    const activity = currentAgentMessageEl.querySelector('.agent-activity');
    if (activity) activity.remove();
  }
  if (currentAnswerBubbleEl && summaryText) {
    currentAnswerBubbleEl.style.display = 'block';
    currentAnswerBubbleEl.innerHTML = formatMarkdown(summaryText);
  }

  scrollToBottom();
}

function setBusyState(busy) {
  isExecuting = busy;
  if (runBtn) runBtn.disabled = busy;
  if (stopBtn) stopBtn.style.display = busy ? 'inline-flex' : 'none';
}

function scrollToBottom() {
  if (!chatContainer) return;
  requestAnimationFrame(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMarkdown(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}
