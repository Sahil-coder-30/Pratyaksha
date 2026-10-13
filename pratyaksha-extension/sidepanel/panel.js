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
const openrouterGroup = document.getElementById('openrouterGroup');
const openrouterApiKey = document.getElementById('openrouterApiKey');
const openrouterModel = document.getElementById('openrouterModel');
const privacyLevel = document.getElementById('privacyLevel');

// DOM Elements — Approval Modal
const approvalModal = document.getElementById('approvalModal');
const approvalToolTitle = document.getElementById('approvalToolTitle');
const approvalReasonText = document.getElementById('approvalReasonText');
const approvalActionDetails = document.getElementById('approvalActionDetails');
const confirmApprovalBtn = document.getElementById('confirmApprovalBtn');
const rejectApprovalBtn = document.getElementById('rejectApprovalBtn');
let currentApprovalRequest = null;

// Active Message State
let currentAgentMessageEl = null;
let currentAnswerBubbleEl = null;
let currentThinkingAccordionEl = null;
let currentThinkingStreamEl = null;
let currentThinkingTimerEl = null;
let currentThinkingBadgeEl = null;
let thinkingStartTime = null;
let thinkingTimerInterval = null;
let currentStepNumber = 1;

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

      if (thinkingTimerInterval) {
        clearInterval(thinkingTimerInterval);
        thinkingTimerInterval = null;
      }

      if (currentThinkingAccordionEl) {
        currentThinkingAccordionEl.classList.add('completed', 'collapsed');
        const statusText = currentThinkingAccordionEl.querySelector('.thinking-status-text');
        if (statusText) statusText.textContent = 'Stopped';
        const pulse = currentThinkingAccordionEl.querySelector('.thinking-pulse-indicator');
        if (pulse) pulse.classList.add('idle');
        const headerBtn = currentThinkingAccordionEl.querySelector('.thinking-header');
        if (headerBtn) headerBtn.setAttribute('aria-expanded', 'false');
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
      if (openrouterGroup) openrouterGroup.style.display = val === 'openrouter' ? 'flex' : 'none';
      if (geminiKeyGroup) geminiKeyGroup.style.display = val === 'gemini' ? 'flex' : 'none';
      if (geminiModelGroup) geminiModelGroup.style.display = val === 'gemini' ? 'flex' : 'none';
    });
  }
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);

  // Approval Modal Handlers
  if (confirmApprovalBtn) {
    confirmApprovalBtn.addEventListener('click', async () => {
      if (approvalModal) approvalModal.style.display = 'none';
      if (activeAgent && currentApprovalRequest) {
        try {
          await activeAgent.approveAction(currentApprovalRequest.token);
        } catch (err) {
          log(`Approval execution failed: ${err.message}`, 'error');
        }
      }
    });
  }

  if (rejectApprovalBtn) {
    rejectApprovalBtn.addEventListener('click', async () => {
      if (approvalModal) approvalModal.style.display = 'none';
      if (activeAgent) {
        await activeAgent.rejectAction('Action rejected by user.');
      }
    });
  }

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
    'geminiApiKey', 'geminiModel', 'openrouterApiKey', 'openrouterModel',
    'privacyMode', 'autonomousMode'
  ]);

  const provider = data.provider || config.provider || 'mistral';
  if (engineSelect) engineSelect.value = provider;

  if (mistralGroup) mistralGroup.style.display = provider === 'mistral' ? 'flex' : 'none';
  if (openrouterGroup) openrouterGroup.style.display = provider === 'openrouter' ? 'flex' : 'none';
  if (geminiKeyGroup) geminiKeyGroup.style.display = provider === 'gemini' ? 'flex' : 'none';
  if (geminiModelGroup) geminiModelGroup.style.display = provider === 'gemini' ? 'flex' : 'none';

  if (mistralApiKey) mistralApiKey.value = data.mistralApiKey || config.mistralApiKey || '';
  if (mistralModel) mistralModel.value = data.mistralModel || config.mistralModel || 'ministral-8b-latest';

  if (openrouterApiKey) openrouterApiKey.value = data.openrouterApiKey || config.openrouterApiKey || '';
  if (openrouterModel) openrouterModel.value = data.openrouterModel || config.openrouterModel || 'deepseek/deepseek-v4.1-flash';

  let activeGeminiModel = data.geminiModel || config.geminiModel || 'gemini-3.5-flash';
  if (geminiApiKey) geminiApiKey.value = data.geminiApiKey || config.geminiApiKey || '';
  if (geminiModel) geminiModel.value = activeGeminiModel;
  if (data.privacyMode && privacyLevel) privacyLevel.value = data.privacyMode;

  if (!data.mistralApiKey && config.mistralApiKey) {
    await chrome.storage.local.set({
      mistralApiKey: config.mistralApiKey,
      mistralModel: config.mistralModel || 'ministral-8b-latest',
      provider: 'mistral'
    });
  }
}

// Save user settings
async function saveSettings() {
  try {
    const provider = engineSelect ? engineSelect.value : 'mistral';
    const config = await getEffectiveConfig();
    const data = await chrome.storage.local.get(['mistralApiKey', 'geminiApiKey', 'openrouterApiKey']);

    const activeMistralKey = (mistralApiKey?.value || '').trim() || data.mistralApiKey || config.mistralApiKey || '';
    const activeGeminiKey = (geminiApiKey?.value || '').trim() || data.geminiApiKey || config.geminiApiKey || '';
    const activeOpenRouterKey = (openrouterApiKey?.value || '').trim() || data.openrouterApiKey || config.openrouterApiKey || '';

    await chrome.storage.local.set({
      provider,
      engineMode: provider,
      mistralApiKey: activeMistralKey,
      mistralModel: mistralModel ? mistralModel.value : 'ministral-8b-latest',
      geminiApiKey: activeGeminiKey,
      geminiModel: geminiModel ? geminiModel.value : 'gemini-3.5-flash',
      openrouterApiKey: activeOpenRouterKey,
      openrouterModel: openrouterModel ? openrouterModel.value : 'deepseek/deepseek-v4.1-flash',
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
        'provider', 'mistralApiKey', 'mistralModel', 'geminiApiKey', 'geminiModel',
        'openrouterApiKey', 'openrouterModel'
      ]);

      const provider = settings.provider || config.provider || 'mistral';
      let apiKey = '';
      let model = '';
      if (provider === 'mistral') {
        apiKey = (settings.mistralApiKey || config.mistralApiKey || '').trim();
        model = settings.mistralModel || config.mistralModel || 'ministral-8b-latest';
      } else if (provider === 'openrouter') {
        apiKey = (settings.openrouterApiKey || config.openrouterApiKey || '').trim();
        model = settings.openrouterModel || config.openrouterModel || 'deepseek/deepseek-v4.1-flash';
      } else {
        apiKey = (settings.geminiApiKey || config.geminiApiKey || '').trim();
        model = settings.geminiModel || config.geminiModel || 'gemini-3.5-flash';
      }

      if (!apiKey && provider !== 'deterministic') {
        const provLabel = provider === 'mistral' ? 'Mistral' : provider === 'openrouter' ? 'OpenRouter' : 'Gemini';
        throw new Error(`${provLabel} API Key is missing. Click ⚙ Settings to configure.`);
      }

      activeAgent = new LangGraphAgent({
        provider,
        apiKey,
        model,
        vault: globalVault,
        maxSteps: 100,
        onEvent: handleAgentEvent
      });

      const result = await activeAgent.run(rawPrompt, activeTab);
      if (activeAgent?.isCancelled) {
        // Stopped cleanly via 1-click stopBtn handler
        return;
      }
      if (result.awaitingUserInput) {
        log(`Task awaiting input: ${result.summary}`, 'warn');
        finishAgentMessage(result.summary, false);
      } else if (result.success) {
        log(`🎉 Autonomous Task Completed in ${result.steps} step(s)!`, 'success');
        finishAgentMessage(result.summary || 'Task completed successfully.');
      } else {
        log(`Task ended: ${result.summary}`, 'warn');
        finishAgentMessage(result.summary || 'Task stopped: verification criteria not fulfilled on current page.', false);
      }
    }
  } catch (err) {
    if (activeAgent?.isCancelled || err.message === 'STOPPED_BY_USER') {
      // Clean stop — already handled in 1-click stopBtn event
      return;
    }
    setOrbState('error');
    let exactMessage = (err?.message && !err.message.includes('Our team has been notified'))
      ? err.message
      : (err?.stack || String(err));
    const lower = `${exactMessage} ${err?.code || ''}`.toLowerCase();
    if (lower.includes('402') || lower.includes('requires more credits') || lower.includes('payment required')) {
      exactMessage = `OpenRouter error (402 Payment Required): Insufficient credits or token allowance. (Hint: OpenRouter requires an active balance. Check key limit at openrouter.ai/settings/keys, pick a free-tier model like deepseek/deepseek-chat:free in Settings, or switch to Gemini). Diagnostic: ${exactMessage}`;
    } else if (lower.includes('err_internet_disconnected') || lower.includes('err_network_changed') || lower.includes('fetch failed')) {
      exactMessage = `Network error (ERR_INTERNET_DISCONNECTED / ERR_NETWORK_CHANGED): Connection to the AI model interrupted or changed. Please verify your internet connection. Diagnostic: ${exactMessage}`;
    }
    log(`[ERROR] ${exactMessage}`, 'error');
    finishAgentMessage(`❌ Error: ${exactMessage}`, false);
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

    if (thinkingTimerInterval) {
      clearInterval(thinkingTimerInterval);
      thinkingTimerInterval = null;
    }
    currentThinkingAccordionEl = null;
    currentThinkingStreamEl = null;
    currentThinkingTimerEl = null;
    currentThinkingBadgeEl = null;

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
    row.innerHTML = `
      <div class="agent-tag-header">
        <span class="agent-ai-icon">✦</span>
        <span class="agent-ai-name">PRATYAKSHA AI</span>
      </div>

      <!-- Thinking Accordion (Live Streaming Thought Process) -->
      <div class="thinking-accordion" id="thinking-${msgId}" role="region" aria-label="Agent reasoning process">
        <button type="button" class="thinking-header" id="thinkingHeader-${msgId}" aria-expanded="true" title="Click to collapse / expand thought trail">
          <div class="thinking-header-left">
            <span class="thinking-pulse-indicator"></span>
            <span class="thinking-status-text">Thinking</span>
            <span class="thinking-timer" id="timer-${msgId}">0.0s</span>
            <span class="thinking-step-pill" id="stepPill-${msgId}">Step 1/100</span>
          </div>
          <div class="thinking-header-right">
            <span class="thinking-chevron">▾</span>
          </div>
        </button>
        <div class="thinking-content" id="thinkingContent-${msgId}">
          <div class="thinking-stream" id="stream-${msgId}">
            <div class="thinking-entry initial">
              <span class="thinking-entry-icon">⚡</span>
              <span class="thinking-entry-text">Scanning page context & initiating autonomous reasoning…</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Agent Final Answer Bubble -->
      <div class="agent-answer-bubble" id="answer-${msgId}" style="display:none;"></div>
    `;

    chatMessages.appendChild(row);

    currentAgentMessageEl = row;
    currentAnswerBubbleEl = row.querySelector(`#answer-${msgId}`);
    currentThinkingAccordionEl = row.querySelector(`#thinking-${msgId}`);
    currentThinkingStreamEl = row.querySelector(`#stream-${msgId}`);
    currentThinkingTimerEl = row.querySelector(`#timer-${msgId}`);
    currentThinkingBadgeEl = row.querySelector(`#stepPill-${msgId}`);

    const headerBtn = row.querySelector(`#thinkingHeader-${msgId}`);
    if (headerBtn) {
      headerBtn.addEventListener('click', () => {
        if (!currentThinkingAccordionEl) return;
        const isCollapsed = currentThinkingAccordionEl.classList.toggle('collapsed');
        headerBtn.setAttribute('aria-expanded', String(!isCollapsed));
      });
    }

    // Start live elapsed timer
    thinkingStartTime = Date.now();
    currentStepNumber = 1;
    if (thinkingTimerInterval) clearInterval(thinkingTimerInterval);
    thinkingTimerInterval = setInterval(() => {
      if (currentThinkingTimerEl && thinkingStartTime) {
        const elapsedSec = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
        currentThinkingTimerEl.textContent = `${elapsedSec}s`;
      }
    }, 100);

    scrollToBottom();
  } catch (err) {
    console.warn('[PRATYAKSHA] createAgentMessageSlot error:', err);
  }
}

function appendThinkingEntry(icon, text, meta = {}) {
  try {
    if (!currentThinkingStreamEl || !text) return;
    const entry = document.createElement('div');
    entry.className = `thinking-entry ${meta.phase || ''}`;
    entry.innerHTML = `
      <span class="thinking-entry-icon">${icon}</span>
      <span class="thinking-entry-text">${escapeHtml(text)}</span>
    `;
    currentThinkingStreamEl.appendChild(entry);

    if (meta.step) {
      currentStepNumber = meta.step;
      if (currentThinkingBadgeEl) {
        currentThinkingBadgeEl.textContent = `Step ${meta.step}/100`;
      }
    }

    const content = currentThinkingAccordionEl?.querySelector('.thinking-content');
    if (content) {
      content.scrollTop = content.scrollHeight;
    }
    scrollToBottom();
  } catch (_) {}
}

function handleAgentEvent(event) {
  try {
    if (!event) return;
    switch (event.type) {
      case 'THINKING': {
        const phaseIcons = {
          intake: '🚀',
          privacy: '🛡️',
          plan: '🗺️',
          policy: '🔒',
          perceive: '🔍',
          reason: '💡',
          thought: '💭',
          action: '⚡',
          observation: '📋',
          verify: '🔎',
          recovery: '🔄',
          finish: '✨'
        };
        const icon = phaseIcons[event.phase] || '•';
        appendThinkingEntry(icon, event.text, event);
        break;
      }

      case 'STATE_CHANGE':
        if (['REASONING', 'ACTING', 'PERCEIVING', 'BACKTRACKING', 'AWAITING_INPUT'].includes(event.state)) {
          setOrbState(event.state === 'AWAITING_INPUT' ? 'idle' : 'thinking');
          if (event.label) {
            appendThinkingEntry('•', event.label.replace(/^Step \d+:\s*/, ''), { phase: 'state' });
          }
        }
        break;

      case 'TOOL_CALL':
        appendThinkingEntry('⚡', `Action: ${event.toolName}`, { step: event.step, phase: 'action' });
        break;

      case 'OBSERVATION':
        if (event.observation) {
          const preview = event.observation.length > 140 ? event.observation.slice(0, 140) + '…' : event.observation;
          appendThinkingEntry('📋', `Observation: ${preview}`, { step: event.step, phase: 'observation' });
        }
        break;

      case 'TASK_COMPLETE': {
        setOrbState('responding');
        if (thinkingTimerInterval) {
          clearInterval(thinkingTimerInterval);
          thinkingTimerInterval = null;
        }
        const elapsed = ((Date.now() - (thinkingStartTime || Date.now())) / 1000).toFixed(1);
        const steps = event.steps || currentStepNumber || 1;
        if (currentThinkingAccordionEl) {
          currentThinkingAccordionEl.classList.add('completed', 'collapsed');
          const statusText = currentThinkingAccordionEl.querySelector('.thinking-status-text');
          if (statusText) statusText.textContent = `Thought for ${elapsed}s (${steps} step${steps === 1 ? '' : 's'})`;
          const pulse = currentThinkingAccordionEl.querySelector('.thinking-pulse-indicator');
          if (pulse) pulse.classList.add('idle');
          const headerBtn = currentThinkingAccordionEl.querySelector('.thinking-header');
          if (headerBtn) headerBtn.setAttribute('aria-expanded', 'false');
        }
        finishAgentMessage(event.summary, true);
        setTimeout(() => { try { setOrbState('idle'); } catch (_) { } }, 2400);
        break;
      }

      case 'BUDGET_REACHED':
        setOrbState('idle');
        if (thinkingTimerInterval) {
          clearInterval(thinkingTimerInterval);
          thinkingTimerInterval = null;
        }
        if (currentThinkingAccordionEl) {
          currentThinkingAccordionEl.classList.add('completed', 'collapsed');
          const statusText = currentThinkingAccordionEl.querySelector('.thinking-status-text');
          if (statusText) statusText.textContent = `Budget limit reached (100 steps)`;
          const pulse = currentThinkingAccordionEl.querySelector('.thinking-pulse-indicator');
          if (pulse) pulse.classList.add('idle');
        }
        finishAgentMessage(event.summary, false);
        break;

      case 'CANCELLED':
        setOrbState('idle');
        if (thinkingTimerInterval) {
          clearInterval(thinkingTimerInterval);
          thinkingTimerInterval = null;
        }
        if (currentThinkingAccordionEl) {
          currentThinkingAccordionEl.classList.add('completed', 'collapsed');
          const statusText = currentThinkingAccordionEl.querySelector('.thinking-status-text');
          if (statusText) statusText.textContent = 'Stopped by user';
          const pulse = currentThinkingAccordionEl.querySelector('.thinking-pulse-indicator');
          if (pulse) pulse.classList.add('idle');
        }
        finishAgentMessage(event.message || 'Execution cancelled by user.', false);
        break;

      case 'TOOL_ERROR':
        setOrbState('error');
        if (event.error) {
          const exactMsg = (event.error && !event.error.includes('Our team has been notified'))
            ? event.error
            : 'Execution failed.';
          appendThinkingEntry('❌', exactMsg, { phase: 'error' });
          log(`⚠️ ${event.code ? `[${event.code}] ` : ''}${exactMsg}`, 'error');
        }
        setTimeout(() => {
          try {
            if (isExecuting) setOrbState('thinking');
            else setOrbState('idle');
          } catch (_) { }
        }, 2000);
        break;

      case 'APPROVAL_REQUIRED':
        currentApprovalRequest = event.request;
        setOrbState('thinking');
        if (approvalModal) {
          if (approvalToolTitle) approvalToolTitle.textContent = `Action: ${event.toolName || event.request?.action?.toolName || 'Sensitive Action'}`;
          if (approvalReasonText) approvalReasonText.textContent = event.reason || event.request?.reason || 'This operation requires your explicit confirmation.';
          if (approvalActionDetails) {
            approvalActionDetails.textContent = JSON.stringify(event.request?.action || {}, null, 2);
          }
          approvalModal.style.display = 'flex';
        }
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
    if (thinkingTimerInterval) {
      clearInterval(thinkingTimerInterval);
      thinkingTimerInterval = null;
    }
    clearTabHighlightsAndCursor();
    if (currentThinkingAccordionEl) {
      currentThinkingAccordionEl.classList.add('completed', 'collapsed');
      const pulse = currentThinkingAccordionEl.querySelector('.thinking-pulse-indicator');
      if (pulse) pulse.classList.add('idle');
      const headerBtn = currentThinkingAccordionEl.querySelector('.thinking-header');
      if (headerBtn) headerBtn.setAttribute('aria-expanded', 'false');
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
