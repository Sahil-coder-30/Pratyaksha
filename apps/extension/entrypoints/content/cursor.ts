// BigFish agent cursor: a visual pointer that glides to each element the agent
// uses, with a click ripple and a short label, plus a frame and an
// "BigFish AI in control" banner while the agent is active on this tab.
// Pure decoration: it never receives events (pointer-events: none), so it does
// not change what the page or elementFromPoint sees. Off via the side panel toggle.

const SETTING_KEY = "bigfish.cursor";
const IDLE_HIDE_MS = 2_500;
const MIN_MOVE_MS = 180;
const MAX_MOVE_MS = 650;

const STYLE = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
  .frame {
    position: fixed; inset: 0; border: 3px solid rgba(37, 99, 235, 0.75); border-radius: 6px;
    box-shadow: inset 0 0 24px rgba(37, 99, 235, 0.25); opacity: 0; transition: opacity 250ms ease;
  }
  .banner {
    position: fixed; top: 10px; left: 50%; transform: translateX(-50%) translateY(-8px);
    display: flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 999px;
    background: #1d4ed8; color: #fff; font: 600 12px/1.2 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: 0 6px 18px rgba(29, 78, 216, 0.35); opacity: 0; transition: opacity 250ms ease, transform 250ms ease;
  }
  .banner .dot { width: 7px; height: 7px; border-radius: 50%; background: #86efac; animation: pulse 1.2s ease-in-out infinite; }
  .on .frame, .on .banner { opacity: 1; }
  .on .banner { transform: translateX(-50%) translateY(0); }
  .cursor {
    position: fixed; left: 0; top: 0; opacity: 0;
    transition-property: transform, opacity; transition-timing-function: cubic-bezier(0.22, 0.8, 0.3, 1);
    filter: drop-shadow(0 3px 6px rgba(15, 23, 42, 0.35));
  }
  .on .cursor { opacity: 1; }
  .cursor svg { display: block; width: 30px; height: 30px; }
  .label {
    position: absolute; left: 26px; top: 24px; white-space: nowrap; padding: 4px 9px; border-radius: 6px;
    background: #0f172a; color: #fff; font: 600 11px/1.3 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .label:empty { display: none; }
  .ripple {
    position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
    border: 3px solid rgba(37, 99, 235, 0.9); animation: ripple 450ms ease-out forwards;
  }
  @keyframes ripple { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
  @keyframes pulse { 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { .cursor { transition-duration: 0ms !important; } .ripple { display: none; } }
`;

const ARROW = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M4 2.5 L19.5 12.2 L12.6 13.6 L9.3 20.5 Z" fill="#2563eb" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;

class AgentCursor {
  private host: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  private cursor: HTMLElement | null = null;
  private label: HTMLElement | null = null;
  private bannerText: HTMLElement | null = null;
  private x = Math.round(window.innerWidth / 2);
  private y = Math.round(window.innerHeight / 2);
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = true;

  constructor() {
    browser.storage.local.get(SETTING_KEY).then(
      (stored) => (this.enabled = stored[SETTING_KEY] !== false),
      () => {},
    );
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !(SETTING_KEY in changes)) return;
      this.enabled = changes[SETTING_KEY]!.newValue !== false;
      if (!this.enabled) this.hide();
    });
  }

  // The agent is doing something on this tab: show the frame and banner for a moment.
  activity(text = "BigFish AI in control"): void {
    if (!this.enabled || !this.mount()) return;
    this.bannerText!.textContent = text;
    this.layer!.classList.add("on");
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), IDLE_HIDE_MS);
  }

  // Glide to the middle of an element, then show what the agent is doing there.
  async pointAt(el: Element, label: string): Promise<void> {
    const r = el.getBoundingClientRect();
    await this.moveTo(r.left + Math.min(r.width / 2, 40), r.top + r.height / 2, label);
  }

  async moveTo(x: number, y: number, label: string): Promise<void> {
    this.activity();
    if (!this.enabled || !this.cursor) return;
    const tx = Math.round(Math.max(4, Math.min(window.innerWidth - 4, x)));
    const ty = Math.round(Math.max(4, Math.min(window.innerHeight - 4, y)));
    const distance = Math.hypot(tx - this.x, ty - this.y);
    const ms = Math.round(Math.min(MAX_MOVE_MS, Math.max(MIN_MOVE_MS, distance * 0.7)));
    this.label!.textContent = label;
    this.cursor.style.transitionDuration = `${ms}ms`;
    this.cursor.style.transform = `translate(${tx - 4}px, ${ty - 3}px)`;
    this.x = tx;
    this.y = ty;
    await sleep(ms);
  }

  // A click ripple at the cursor.
  async press(): Promise<void> {
    if (!this.enabled || !this.layer) return;
    const ripple = document.createElement("div");
    ripple.className = "ripple";
    ripple.style.left = `${this.x}px`;
    ripple.style.top = `${this.y}px`;
    this.layer.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
    await sleep(120);
  }

  private hide(): void {
    this.layer?.classList.remove("on");
    if (this.label) this.label.textContent = "";
  }

  private mount(): boolean {
    if (this.host?.isConnected) return true;
    if (!document.documentElement) return false;
    this.host = document.createElement("bigfish-agent-cursor");
    const root = this.host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="layer">
        <div class="frame"></div>
        <div class="banner"><span class="dot"></span><span class="banner-text"></span></div>
        <div class="cursor">${ARROW}<span class="label"></span></div>
      </div>`;
    this.layer = root.querySelector(".layer");
    this.cursor = root.querySelector(".cursor");
    this.label = root.querySelector(".label");
    this.bannerText = root.querySelector(".banner-text");
    this.cursor!.style.transform = `translate(${this.x}px, ${this.y}px)`;
    document.documentElement.appendChild(this.host);
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const agentCursor = new AgentCursor();
