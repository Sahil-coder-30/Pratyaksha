// BigFish Simplified Entry Controller
import type { AgentEvent } from "@bigfish/contracts";
import type { ConnState, ConnStatus } from "../background/conn/connection.js";
import { startAgentRun, type AgentRun } from "./agent-client.js";
import type { ApprovalRequest } from "../../safety/approval.js";
import { setupVoiceInput } from "./voice-input.js";
import { HexagonalVault } from "./hexagonal-vault.js";

const CONN_LABELS: Record<ConnState, string> = {
  signed_out: "Signed out",
  idle: "Starting",
  ticket: "Connecting",
  connecting: "Connecting",
  mcp_init: "Connecting",
  ready: "Connected",
  backoff: "Retrying",
  stopped: "Stopped",
};

const STEP_LABELS: Record<Extract<AgentEvent, { type: "step" }>["node"], string> = {
  plan: "Planning",
  act: "Working",
  verify: "Checking",
  finalize: "Writing answer",
};

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortArgs(args: Record<string, unknown>): string {
  const text = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

// A short, readable name for a tool call in the run log.
function toolLabel(name: string, args: Record<string, unknown>): string {
  const a = args as Record<string, any>;
  switch (name) {
    case "browser_navigate":
      return a.url ? `Open ${String(a.url).replace(/^https?:\/\//, "")}` : `Go ${a.action}`;
    case "browser_snapshot":
      return a.mode === "text" ? (a.from_end ? "Read the latest text" : "Read the page") : "Look at the page";
    case "browser_find":
      return `Find "${a.query}"`;
    case "browser_click":
      return `Click ${a.ref}`;
    case "browser_type":
      return `Type "${String(a.text ?? "").slice(0, 40)}" into ${a.ref}${a.submit ? " and submit" : ""}`;
    case "browser_fill_form":
      return `Fill ${(a.fields ?? []).length} fields`;
    case "browser_select":
      return `Choose "${a.option}" in ${a.ref}`;
    case "browser_press_key":
      return `Press ${a.key}`;
    case "browser_scroll":
      return `Scroll ${a.direction}`;
    case "browser_wait_for":
      return a.idle ? "Wait for the page to finish" : `Wait for ${a.text ? `"${a.text}"` : a.gone_text ? `"${a.gone_text}" to go` : a.url_contains ?? a.ref}`;
    case "browser_extract":
      return `Extract ${a.what}`;
    case "browser_tabs":
      return a.action === "list" ? "List tabs" : `${a.action} tab ${a.tab}`;
    default:
      return `${name.replace(/^browser_/, "")} ${shortArgs(args)}`;
  }
}

// One line for a tool result: the delta, or the error code and message.
function resultSummary(text: string): string {
  const clean = text.replace(/<\/?page untrusted>/g, "").trim();
  const line = clean.split("\n").find((l) => l.trim() && !l.startsWith("[tab ")) ?? "";
  return firstLine(line.replace(/^ok\s*/, ""));
}

function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 90 ? `${line.slice(0, 87)}...` : line;
}

interface StatusReply {
  ok: boolean;
  error?: string;
  status?: ConnStatus;
  email?: string | null;
}

document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.querySelector<HTMLTextAreaElement>("#cmd-input");
  const submitBtn = document.querySelector<HTMLButtonElement>("#btn-submit");
  const micBtn = document.querySelector<HTMLButtonElement>("#btn-mic");
  const inputHint = document.querySelector<HTMLElement>("#input-hint");
  const resetBtn = document.querySelector<HTMLButtonElement>("#btn-reset");
  const cursorBtn = document.querySelector<HTMLButtonElement>("#btn-cursor");
  const themeToggleBtn = document.querySelector<HTMLButtonElement>("#btn-theme-toggle");

  // Agent cursor on the page (content script reads the same setting).
  const CURSOR_KEY = "bigfish.cursor";
  const renderCursorToggle = (on: boolean) => {
    if (!cursorBtn) return;
    cursorBtn.setAttribute("aria-pressed", String(on));
    cursorBtn.title = `Agent cursor: ${on ? "on" : "off"}`;
  };
  void browser.storage.local.get(CURSOR_KEY).then((stored) => renderCursorToggle(stored[CURSOR_KEY] !== false));
  cursorBtn?.addEventListener("click", () => {
    const on = cursorBtn.getAttribute("aria-pressed") !== "true";
    renderCursorToggle(on);
    void browser.storage.local.set({ [CURSOR_KEY]: on });
  });

  // Hexagonal Vault WebGL2 Background
  let vaultEngine: any = null;
  const canvasEl = document.querySelector<HTMLCanvasElement>("#particleWaveCanvas");
  if (canvasEl) {
    try {
      vaultEngine = new HexagonalVault(canvasEl, {
        theme: document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
      });
    } catch (err) {
      console.warn("[BigFish] HexagonalVault init error:", err);
    }
  }

  // Dual Theme Toggle (Dark / Light)
  const THEME_KEY = "bigfish.theme";
  const renderTheme = (theme: "light" | "dark") => {
    document.documentElement.setAttribute("data-theme", theme);
    if (vaultEngine) {
      vaultEngine.setTheme(theme);
    }
    if (themeToggleBtn) {
      themeToggleBtn.setAttribute("data-theme", theme);
      themeToggleBtn.title = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
      const darkIcon = themeToggleBtn.querySelector(".theme-icon-dark");
      const lightIcon = themeToggleBtn.querySelector(".theme-icon-light");
      if (darkIcon && lightIcon) {
        (darkIcon as HTMLElement).style.display = theme === "dark" ? "inline-block" : "none";
        (lightIcon as HTMLElement).style.display = theme === "dark" ? "none" : "inline-block";
      }
    }
  };
  void browser.storage.local.get(THEME_KEY).then((stored) => {
    const theme = (stored[THEME_KEY] as "light" | "dark") || "dark";
    renderTheme(theme);
  });
  themeToggleBtn?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next = current === "dark" ? "light" : "dark";
    renderTheme(next);
    void browser.storage.local.set({ [THEME_KEY]: next });
  });
  const welcomeView = document.querySelector<HTMLElement>("#welcome-view");
  const feedView = document.querySelector<HTMLElement>("#feed-view");
  const slashBtn = document.querySelector<HTMLButtonElement>("#btn-quick-command");
  const slashMenu = document.querySelector<HTMLElement>("#slash-menu");
  const actionCards = document.querySelectorAll<HTMLButtonElement>(".action-card");
  const activeTabTitle = document.querySelector<HTMLElement>("#active-tab-title");

  const connIndicator = document.querySelector<HTMLElement>("#conn-indicator");
  const connLabel = document.querySelector<HTMLElement>("#conn-label");
  const connDetail = document.querySelector<HTMLElement>("#conn-detail");
  const accountEmail = document.querySelector<HTMLElement>("#account-email");
  const signInBtn = document.querySelector<HTMLButtonElement>("#btn-sign-in");
  const signOutBtn = document.querySelector<HTMLButtonElement>("#btn-sign-out");
  const connectBtn = document.querySelector<HTMLButtonElement>("#btn-connect");

  // Detect active tab title
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (tabs[0]?.title && activeTabTitle) {
      activeTabTitle.textContent = tabs[0].title;
    }
  });

  // Account and connection state, owned by the service worker
  let signedInEmail: string | null = null;

  function renderStatus(status: ConnStatus): void {
    if (connIndicator) connIndicator.dataset.state = status.state;
    if (connLabel) connLabel.textContent = CONN_LABELS[status.state];
    if (connDetail) connDetail.textContent = status.state === "ready" ? "" : (status.detail ?? "");
    if (connectBtn) connectBtn.hidden = !signedInEmail || !(status.state === "stopped" || status.state === "backoff");
  }

  function renderAccount(email: string | null): void {
    signedInEmail = email;
    if (accountEmail) accountEmail.textContent = email ?? "Not signed in";
    if (signInBtn) signInBtn.hidden = Boolean(email);
    if (signOutBtn) signOutBtn.hidden = !email;
  }

  async function ask(type: string, button?: HTMLButtonElement | null): Promise<void> {
    if (button) button.disabled = true;
    try {
      const reply = (await browser.runtime.sendMessage({ type })) as StatusReply;
      if (!reply?.ok) {
        if (connDetail) connDetail.textContent = reply?.error ?? "Request failed.";
        return;
      }
      renderAccount(reply.email ?? null);
      if (reply.status) renderStatus(reply.status);
    } finally {
      if (button) button.disabled = false;
    }
  }

  signInBtn?.addEventListener("click", () => void ask("BIGFISH_SIGN_IN", signInBtn));
  signOutBtn?.addEventListener("click", () => void ask("BIGFISH_SIGN_OUT", signOutBtn));
  connectBtn?.addEventListener("click", () => void ask("BIGFISH_CONNECT", connectBtn));
  void ask("BIGFISH_PANEL_OPENED");

  // Quick Action Cards trigger
  actionCards.forEach((card) => {
    card.addEventListener("click", () => {
      const cmd = card.getAttribute("data-cmd");
      if (cmd) {
        void executeCommand(cmd);
      }
    });
  });

  // Slash commands toggle
  if (slashBtn && slashMenu) {
    slashBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      slashMenu.style.display = slashMenu.style.display === "none" ? "flex" : "none";
    });

    document.addEventListener("click", (e) => {
      if (!slashMenu.contains(e.target as Node) && e.target !== slashBtn) {
        slashMenu.style.display = "none";
      }
    });

    slashMenu.querySelectorAll(".menu-item").forEach((item) => {
      item.addEventListener("click", () => {
        const cmd = item.getAttribute("data-cmd");
        if (cmd && inputEl) {
          inputEl.value = `${cmd} `;
          inputEl.focus();
          slashMenu.style.display = "none";
        }
      });
    });
  }

  const voice = inputEl && micBtn && inputHint ? setupVoiceInput({ input: inputEl, button: micBtn, hint: inputHint }) : null;

  // Auto-resize input & handle Enter key
  if (inputEl) {
    inputEl.addEventListener("input", () => {
      inputEl.style.height = "auto";
      inputEl.style.height = `${Math.min(inputEl.scrollHeight, 100)}px`;
    });

    inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = inputEl.value.trim();
        if (text) {
          voice?.cancel();
          void executeCommand(text);
          inputEl.value = "";
          inputEl.style.height = "auto";
        }
      }
    });
  }

  if (submitBtn && inputEl) {
    submitBtn.addEventListener("click", () => {
      const text = inputEl.value.trim();
      if (text) {
        voice?.cancel();
        void executeCommand(text);
        inputEl.value = "";
        inputEl.style.height = "auto";
      }
    });
  }

  // One agent run at a time. Reset also cancels it.
  let activeRun: AgentRun | null = null;

  // Reset to Home/Welcome View
  if (resetBtn && welcomeView && feedView) {
    resetBtn.addEventListener("click", () => {
      void activeRun?.cancel();
      feedView.innerHTML = "";
      feedView.style.display = "none";
      welcomeView.style.display = "flex";
      if (inputEl) inputEl.focus();
    });
  }

  // While a run is going, the input and quick actions are locked; Cancel lives on the run card.
  function setBusy(busy: boolean): void {
    if (inputEl) {
      inputEl.disabled = busy;
      inputEl.placeholder = busy ? "BigFish is working… cancel the run to send another task" : "Ask BigFish what to do on this page... (e.g. click button, summarize, extract)";
    }
    if (submitBtn) submitBtn.disabled = busy;
    if (micBtn) micBtn.disabled = busy;
    if (busy) voice?.cancel();
    actionCards.forEach((card) => (card.disabled = busy));
  }

  // Run a prompt with the agent on the server and show its steps live.
  async function executeCommand(prompt: string): Promise<void> {
    if (!welcomeView || !feedView || activeRun) return;

    welcomeView.style.display = "none";
    feedView.style.display = "flex";
    setBusy(true);

    const card = renderRunCard(prompt);
    feedView.appendChild(card.root);
    scrollFeed();

    try {
      activeRun = await startAgentRun(prompt, (event) => {
        card.onEvent(event);
        scrollFeed();
      });
      card.setCancel(() => void activeRun?.cancel());
      await activeRun.done;
      card.finish();
    } catch (err) {
      card.fail(err instanceof Error ? err.message : String(err));
    } finally {
      activeRun = null;
      setBusy(false);
      inputEl?.focus();
      scrollFeed();
    }
  }

  function scrollFeed(): void {
    const canvas = document.querySelector(".main-canvas");
    if (canvas) canvas.scrollTop = canvas.scrollHeight;
  }

  // A task card: the prompt, the plan as a checklist, a live log of tool calls,
  // and the final answer. Server and page text is always set with textContent.
  function renderRunCard(prompt: string) {
    const root = el("div", "task-item");
    root.appendChild(el("div", "user-prompt-card", prompt));

    const agentCard = el("div", "agent-result-card");
    const header = el("div", "result-header");
    const badge = el("span", "result-badge run-badge", "Starting");
    badge.dataset.state = "running";
    const meta = el("span", "run-meta", "");
    const cancelBtn = el("button", "btn-cancel-sm", "Cancel") as HTMLButtonElement;
    cancelBtn.hidden = true;
    const right = el("div", "run-header-right");
    right.append(meta, cancelBtn);
    header.append(badge, right);
    const plan = el("ol", "run-plan");
    const log = el("ol", "run-log");
    const answerBox = el("div", "run-answer-box");
    answerBox.hidden = true;
    const answer = el("div", "result-body run-answer");
    answerBox.append(el("div", "run-answer-label", "Answer"), answer);
    agentCard.append(header, plan, log, answerBox);
    root.appendChild(agentCard);

    const planItems = new Map<number, HTMLElement>();
    const toolLines = new Map<string, HTMLElement>();
    const started = Date.now();
    let tools = 0;
    let ended = false;
    const tick = setInterval(() => updateMeta(), 1000);

    function updateMeta(): void {
      const secs = Math.round((Date.now() - started) / 1000);
      meta.textContent = `${secs}s · ${tools} tool${tools === 1 ? "" : "s"}`;
    }
    const addLine = (text: string, kind: string) => {
      const line = el("li", `run-log-item ${kind}`, text);
      log.appendChild(line);
      return line;
    };
    const setBadge = (text: string, state: "running" | "done" | "error") => {
      badge.textContent = text;
      badge.dataset.state = state;
    };
    const markSubtask = (id: number | undefined, state: "working" | "done" | "failed") => {
      if (id === undefined) return;
      const item = planItems.get(id);
      if (item) item.dataset.state = state;
    };
    const end = () => {
      ended = true;
      cancelBtn.hidden = true;
      clearInterval(tick);
      updateMeta();
      for (const line of toolLines.values()) if (line.classList.contains("pending")) line.className = "run-log-item tool failed";
    };
    const showAnswer = (text: string, isError: boolean) => {
      answerBox.hidden = false;
      answerBox.classList.toggle("error", isError);
      answer.textContent = text;
    };
    updateMeta();

    return {
      root,
      setCancel(cancel: () => void) {
        if (ended) return;
        cancelBtn.hidden = false;
        cancelBtn.onclick = () => {
          cancelBtn.disabled = true;
          cancelBtn.textContent = "Cancelling";
          cancel();
        };
      },
      onEvent(event: AgentEvent) {
        switch (event.type) {
          case "run":
            setBadge("Planning", "running");
            break;
          case "plan":
            for (const s of event.subtasks) {
              const item = el("li", "run-plan-item", s.goal);
              item.dataset.state = "pending";
              plan.appendChild(item);
              planItems.set(s.id, item);
            }
            break;
          case "step":
            setBadge(STEP_LABELS[event.node], "running");
            if (event.node === "act") {
              markSubtask(event.subtask, "working");
              if (event.message.startsWith("Retrying")) addLine(event.message, "step retry");
              else if (event.message.startsWith("Saved ")) addLine(event.message, "step saved");
            } else if (event.node === "verify") {
              const passed = event.message.startsWith("Passed");
              markSubtask(event.subtask, passed ? "done" : "failed");
              if (!passed) addLine(event.message, "step not-done");
            }
            break;
          case "tool_call":
            tools++;
            updateMeta();
            toolLines.set(event.toolCallId, addLine(toolLabel(event.name, event.args), "tool pending"));
            break;
          case "progress": {
            const line = toolLines.get(event.toolCallId);
            if (line && event.message) line.dataset.progress = event.message;
            break;
          }
          case "tool_result": {
            const line = toolLines.get(event.toolCallId);
            if (!line) break;
            delete line.dataset.progress;
            line.className = `run-log-item tool ${event.ok ? "ok" : "failed"}`;
            line.appendChild(el("span", "run-log-detail", resultSummary(event.text)));
            break;
          }
          case "final":
            setBadge("Done", "done");
            showAnswer(event.answer, false);
            end();
            break;
          case "error":
            setBadge(event.code === "CANCELLED" ? "Cancelled" : `Stopped: ${event.code}`, "error");
            showAnswer(event.message, true);
            end();
            break;
        }
      },
      // Stream ended. If no final or error came, the connection dropped.
      finish() {
        if (ended) return;
        setBadge("Stopped", "error");
        showAnswer("The connection to the server closed before the run finished.", true);
        end();
      },
      fail(message: string) {
        setBadge("Could not start", "error");
        showAnswer(message, true);
        end();
      },
    };
  }

  // Approval cards, by request id, so they can close when the request ends elsewhere.
  const approvalCards = new Map<string, HTMLElement>();
  // Opened as a popup for one approval (no side panel was open).
  const popupApprovalId = new URLSearchParams(location.search).get("approvalId");

  function showApproval(req: ApprovalRequest): void {
    if (!feedView || approvalCards.has(req.id)) return;
    feedView.style.display = "flex";
    if (welcomeView) welcomeView.style.display = "none";

    const card = el("div", "agent-result-card approval-card");
    const head = el("div", "result-header");
    head.append(el("span", "result-badge approval-badge", "Approval needed"), el("span", "result-tool", req.tool));
    const body = el("div", "result-body");
    body.append(el("strong", "", req.reason), el("p", "approval-origin", `On: ${req.origin || "current tab"}`));
    const buttons = el("div", "approval-btn-group");
    const approve = el("button", "btn-confirm-sm", "Approve") as HTMLButtonElement;
    const deny = el("button", "btn-cancel-sm", "Deny") as HTMLButtonElement;
    buttons.append(approve, deny);
    body.appendChild(buttons);
    card.append(head, body);
    feedView.appendChild(card);
    approvalCards.set(req.id, card);
    scrollFeed();

    const decide = (approved: boolean) => {
      approve.disabled = deny.disabled = true;
      void browser.runtime.sendMessage({ type: "RESOLVE_APPROVAL", id: req.id, approved });
      settleApproval(req.id, approved ? "Approved" : "Denied");
      if (popupApprovalId) setTimeout(() => window.close(), 400);
    };
    approve.addEventListener("click", () => decide(true));
    deny.addEventListener("click", () => decide(false));
  }

  function settleApproval(id: string, outcome: string): void {
    const card = approvalCards.get(id);
    if (!card) return;
    approvalCards.delete(id);
    card.querySelector(".approval-btn-group")?.replaceWith(el("span", `approval-outcome ${outcome.toLowerCase()}`, outcome));
  }

  if (popupApprovalId) {
    void browser.runtime.sendMessage({ type: "BIGFISH_GET_APPROVAL", id: popupApprovalId }).then((reply: any) => {
      if (reply?.request) showApproval(reply.request);
      else window.close();
    });
  }

  // Connection updates and approval requests from the background service worker
  browser.runtime.onMessage.addListener((msg: any) => {
    if (msg?.type === "BIGFISH_CONN_STATUS") {
      renderStatus(msg.status);
      // A status change can mean a sign-in finished elsewhere. Refresh the email.
      if (msg.status.state === "ready" && !signedInEmail) void ask("BIGFISH_GET_STATUS");
      return;
    }
    if (msg?.type === "BIGFISH_APPROVAL_REQUEST") {
      // A popup only shows its own request.
      if (!popupApprovalId || msg.payload?.id === popupApprovalId) showApproval(msg.payload);
      return;
    }
    if (msg?.type === "BIGFISH_APPROVAL_CLOSED") {
      settleApproval(msg.id, "Closed");
    }
  });
});
