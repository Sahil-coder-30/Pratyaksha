/**
 * PRATYAKSHA Side Panel Controller — Minimal Chat Interface
 */

import { globalVault } from '../vault/pii-vault.js';
import { getEffectiveConfig } from '../env.js';
import { LangGraphAgent } from '../agent/graph-engine.js';
import { Orb3DController } from './orb-3d.js';

let activeTab = null;
let pageContext = null;
let isExecuting = false;
let activeAgent = null;
let activeOrb3D = null;

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
  initOrb3D();
});

function initOrb3D() {
  try {
    const canvas = document.getElementById('orb3dCanvas');
    if (canvas) {
      if (activeOrb3D) {
        try { activeOrb3D.destroy(); } catch (_) { }
      }
      activeOrb3D = new Orb3DController(canvas);
    }
  } catch (err) {
    console.warn('[PRATYAKSHA] Error initializing Orb3DController:', err);
  }
}

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

      // Instantly clear element highlights and agent cursor on the inspected webpage
      clearTabHighlightsAndCursor();

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

  // New Chat Button
  const newChatBtn = document.getElementById('newChatBtn');
  if (newChatBtn) {
    newChatBtn.addEventListener('click', handleNewChat);
  }

  // Pre-task quick action suggestion pills
  document.addEventListener('click', (e) => {
    const pill = e.target.closest('.pretask-pill');
    if (!pill) return;
    const task = pill.dataset.task;
    if (!task || !promptInput) return;
    promptInput.value = task;
    promptInput.style.height = 'auto';
    promptInput.focus();
    handleRunPrompt();
  });

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

  // Subtle 3D background mouse parallax
  try {
    const ambientAura = document.getElementById('ambientAura');
    if (ambientAura) {
      window.addEventListener('pointermove', (e) => {
        try {
          if (!window.innerWidth || !window.innerHeight) return;
          const x = (e.clientX / window.innerWidth - 0.5) * 16;
          const y = (e.clientY / window.innerHeight - 0.5) * 16;
          ambientAura.style.setProperty('--aura-mouse-x', `${x.toFixed(1)}px`);
          ambientAura.style.setProperty('--aura-mouse-y', `${y.toFixed(1)}px`);
        } catch (_) { }
      }, { passive: true });
    }
  } catch (_) { }
}

// Internal trace events are intentionally not rendered in the customer UI.
function log() { }

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
  }
}

// Save user settings
async function saveSettings() {
  try {
    const provider = engineSelect ? engineSelect.value : 'mistral';
    const config = await getEffectiveConfig();
    const data = await chrome.storage.local.get(['mistralApiKey', 'geminiApiKey']);

    const activeMistralKey = (mistralApiKey?.value || '').trim() || data.mistralApiKey || config.mistralApiKey || '';
    const activeGeminiKey = (geminiApiKey?.value || '').trim() || data.geminiApiKey || config.geminiApiKey || '';

    await chrome.storage.local.set({
      provider,
      engineMode: provider,
      mistralApiKey: activeMistralKey,
      mistralModel: mistralModel ? mistralModel.value : 'mistral-large-latest',
      geminiApiKey: activeGeminiKey,
      geminiModel: geminiModel ? geminiModel.value : 'gemini-3.8-flash',
      privacyMode: privacyLevel ? privacyLevel.value : 'strict'
    });

    if (settingsModal) settingsModal.style.display = 'none';
    log(`Settings updated. Active provider: ${provider.toUpperCase()}`, 'info');
  } catch (err) {
    console.error('[PRATYAKSHA] Error saving settings:', err);
  }
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
    try { hostname = new URL(response.url).hostname; } catch (_) { }
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
  if (activeOrb3D) {
    activeOrb3D.stop();
  }
  document.getElementById('welcomeScreen')?.remove();

  // 1. Render User Message Bubble
  renderUserMessage(rawPrompt);

  // 2. Show a quiet activity state while the agent works.
  createAgentMessageSlot();

  setBusyState(true);
  if (activeTab?.id) {
    try {
      chrome.tabs.sendMessage(activeTab.id, { type: 'SET_CONTROL_ACTIVE', active: true }, () => {
        if (chrome.runtime.lastError) { }
      });
    } catch (_) { }
  }
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
    setOrbState('error');
    log(`[ERROR] ${err.message}`, 'error');
    finishAgentMessage(`❌ Error: ${err.message}`, false);
  } finally {
    setBusyState(false);
    clearTabHighlightsAndCursor();
    setTimeout(() => { activeAgent = null; }, 300);
  }
}

// ── Chat Rendering Functions ─────────────────────────────────

function renderUserMessage(text) {
  try {
    if (!chatMessages) return;
    const row = document.createElement('div');
    row.className = 'chat-row user';
    row.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
    chatMessages.appendChild(row);
    scrollToBottom();
  } catch (err) {
    console.warn('[PRATYAKSHA] renderUserMessage error:', err);
  }
}

function setOrbState(state) {
  try {
    const orbs = document.querySelectorAll('.pratyaksha-orb-container, .header-mini-orb');
    orbs.forEach(orb => {
      if (orb?.dataset) orb.dataset.state = state;
    });
    const aura = document.getElementById('ambientAura');
    if (aura?.dataset) {
      aura.dataset.state = state;
    }
    if (activeOrb3D && typeof activeOrb3D.setState === 'function') {
      activeOrb3D.setState(state);
    }
  } catch (err) {
    console.warn('[PRATYAKSHA] setOrbState warning:', err);
  }
}

function handleNewChat() {
  try {
    if (activeAgent) {
      try { activeAgent.cancel(); } catch (_) { }
      setBusyState(false);
    }
    clearTabHighlightsAndCursor();

    if (chatMessages) {
      chatMessages.innerHTML = '';
      renderWelcomeScreen();
    }

    if (promptInput) {
      promptInput.value = '';
      promptInput.style.height = 'auto';
      try { promptInput.focus(); } catch (_) { }
    }

    currentAgentMessageEl = null;
    currentAnswerBubbleEl = null;
    setOrbState('idle');
  } catch (err) {
    console.warn('[PRATYAKSHA] handleNewChat error:', err);
  }
}

function renderWelcomeScreen() {
  try {
    if (!chatMessages) return;
    const welcomeSection = document.createElement('section');
    welcomeSection.className = 'welcome-state';
    welcomeSection.id = 'welcomeScreen';
    welcomeSection.setAttribute('aria-labelledby', 'welcomeTitle');

    welcomeSection.innerHTML = `
      <!-- 3D Multi-Orb System (Volumetric Central Sphere & 3D Orbiting Satellites) -->
      <div class="pratyaksha-orb-container" id="welcomeOrb" data-state="idle" role="img" aria-label="PRATYAKSHA 3D AI Orb">
        <div class="orb-halo"></div>
        <canvas id="orb3dCanvas" class="orb-3d-canvas" width="220" height="220"></canvas>
        <div class="orb-ground-shadow"></div>
      </div>

      <h1 id="welcomeTitle">What can I help you with?</h1>

      <!-- Pre-Task Suggestion Pills -->
      <div class="welcome-pretasks" id="welcomePretasks" role="group" aria-label="Suggested quick tasks">
        <button type="button" class="pretask-pill" data-task="Summarize this page in 3 key takeaways" title="Summarize page content">
          <span class="pretask-icon">⚡</span>
          <span class="pretask-text">Summarize page</span>
        </button>
        <button type="button" class="pretask-pill" data-task="Extract all data, tables, and statistics from this page" title="Extract structured data">
          <span class="pretask-icon">📊</span>
          <span class="pretask-text">Extract data</span>
        </button>
        <button type="button" class="pretask-pill" data-task="Find inputs on this page and help me fill out the form" title="Fill out inputs and forms">
          <span class="pretask-icon">✍️</span>
          <span class="pretask-text">Fill form</span>
        </button>
        <button type="button" class="pretask-pill" data-task="Locate the primary action buttons and navigation links on this page" title="Identify main buttons and actions">
          <span class="pretask-icon">🎯</span>
          <span class="pretask-text">Key actions</span>
        </button>
      </div>
    `;

    chatMessages.appendChild(welcomeSection);
    initOrb3D();
  } catch (err) {
    console.warn('[PRATYAKSHA] renderWelcomeScreen error:', err);
  }
}

function createAgentMessageSlot() {
  try {
    if (!chatMessages) return;
    const msgId = Date.now();
    const row = document.createElement('div');
    row.className = 'chat-row agent';
    row.id = `msg-${msgId}`;
    row.innerHTML = `<div class="agent-tag-header"><span class="agent-ai-icon">✦</span><span class="agent-ai-name">PRATYAKSHA AI</span></div><div class="agent-activity" role="status" aria-label="Working"><div class="micro-orb" data-state="thinking"><div class="micro-orb-core"></div><div class="micro-orb-ring"></div></div><span class="activity-label">Thinking…</span></div><div class="agent-answer-bubble" id="answer-${msgId}" style="display:none;"></div>`;

    chatMessages.appendChild(row);

    currentAgentMessageEl = row;
    currentAnswerBubbleEl = row.querySelector(`#answer-${msgId}`);

    scrollToBottom();
  } catch (err) {
    console.warn('[PRATYAKSHA] createAgentMessageSlot error:', err);
  }
}

function handleAgentEvent(event) {
  try {
    if (!event) return;
    switch (event.type) {
      case 'STATE_CHANGE':
        if (['REASONING', 'ACTING', 'PERCEIVING', 'BACKTRACKING'].includes(event.state)) {
          setOrbState('thinking');
          const actLabel = currentAgentMessageEl?.querySelector('.activity-label');
          if (actLabel && event.label) {
            actLabel.textContent = event.label.replace(/^Step \d+:\s*/, '');
          }
        }
        break;

      case 'TASK_COMPLETE':
        setOrbState('responding');
        finishAgentMessage(event.summary, true);
        setTimeout(() => { try { setOrbState('idle'); } catch (_) { } }, 2400);
        break;

      case 'BUDGET_REACHED':
        setOrbState('idle');
        finishAgentMessage(event.summary, false);
        break;

      case 'CANCELLED':
        setOrbState('idle');
        finishAgentMessage(event.message || 'Execution cancelled by user.', false);
        break;

      case 'TOOL_ERROR':
        setOrbState('error');
        setTimeout(() => {
          try {
            if (isExecuting) setOrbState('thinking');
            else setOrbState('idle');
          } catch (_) { }
        }, 2000);
        break;
    }
  } catch (err) {
    console.warn('[PRATYAKSHA] handleAgentEvent error:', err);
  }
}

function clearTabHighlightsAndCursor() {
  if (!activeTab?.id) return;
  try {
    chrome.tabs.sendMessage(activeTab.id, { type: 'CLEAR_HIGHLIGHT' }, () => {
      if (chrome.runtime.lastError) { }
    });
  } catch (_) { }
  try {
    chrome.tabs.sendMessage(activeTab.id, { type: 'SET_CONTROL_ACTIVE', active: false }, () => {
      if (chrome.runtime.lastError) { }
    });
  } catch (_) { }
  try {
    chrome.tabs.sendMessage(activeTab.id, { type: 'EXECUTE_ACTION', payload: { action: 'CLEAR_HIGHLIGHT' } }, () => {
      if (chrome.runtime.lastError) { }
    });
  } catch (_) { }
}

function finishAgentMessage(summaryText, isSuccess = true) {
  try {
    clearTabHighlightsAndCursor();
    if (currentAgentMessageEl) {
      const activity = currentAgentMessageEl.querySelector('.agent-activity');
      if (activity) {
        try { activity.remove(); } catch (_) { }
      }
    }
    if (currentAnswerBubbleEl && summaryText) {
      currentAnswerBubbleEl.style.display = 'block';
      currentAnswerBubbleEl.innerHTML = formatMarkdown(summaryText);
    }
    scrollToBottom();
  } catch (err) {
    console.warn('[PRATYAKSHA] finishAgentMessage error:', err);
  }
}

function setBusyState(busy) {
  try {
    isExecuting = busy;
    if (runBtn) runBtn.disabled = busy;
    if (stopBtn) stopBtn.style.display = busy ? 'inline-flex' : 'none';
    setOrbState(busy ? 'thinking' : 'idle');
  } catch (err) {
    console.warn('[PRATYAKSHA] setBusyState error:', err);
  }
}

function scrollToBottom() {
  try {
    if (!chatContainer) return;
    requestAnimationFrame(() => {
      try {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      } catch (_) { }
    });
  } catch (_) { }
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
