// BigFish Tab Manager: slot <-> tabId map, the next free ref id per tab, and the
// "BigFish" tab group. Kept in chrome.storage.session, so refs still point at
// the right tab after the service worker restarts.

type Tab = Browser.tabs.Tab;

interface TabState {
  slots: Record<number, number>; // slot -> tabId
  nextSlot: number;
  nextId: Record<number, number>; // tabId -> next free ref id
  agentTabs: number[];
  // Refs in the last snapshot of each tab, to mark new ones with "*".
  lastRefs: Record<number, string[]>;
}

const STORAGE_KEY = "bigfish.tabs";

export class TabManager {
  private state: TabState = { slots: {}, nextSlot: 1, nextId: {}, agentTabs: [], lastRefs: {} };
  private readonly ready: Promise<void>;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.ready = browser.storage.session.get(STORAGE_KEY).then(
      (stored) => {
        if (stored[STORAGE_KEY]) this.state = { ...this.state, ...(stored[STORAGE_KEY] as TabState) };
      },
      () => {},
    );
    browser.tabs.onRemoved.addListener((tabId) => void this.forget(tabId));
  }

  async getActiveTab(): Promise<Tab | null> {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    return tab ?? null;
  }

  async getTabBySlot(slot: number): Promise<Tab | null> {
    await this.ready;
    const tabId = this.state.slots[slot];
    if (tabId === undefined) return null;
    try {
      return await browser.tabs.get(tabId);
    } catch {
      await this.forget(tabId);
      return null;
    }
  }

  // The tab a ref like "2:45" belongs to.
  async getTabForRef(ref: string): Promise<Tab | null> {
    const slot = Number(ref.split(":")[0]);
    return Number.isInteger(slot) ? this.getTabBySlot(slot) : null;
  }

  async slotOf(tabId: number, isAgentCreated = false): Promise<number> {
    await this.ready;
    let slot = this.findSlot(tabId);
    if (slot === undefined) {
      slot = this.state.nextSlot++;
      this.state.slots[slot] = tabId;
    }
    if (isAgentCreated && !this.state.agentTabs.includes(tabId)) this.state.agentTabs.push(tabId);
    this.save();
    return slot;
  }

  // Kept for callers that cannot wait (tab created events).
  registerTab(tabId: number, isAgentCreated = false): void {
    void this.slotOf(tabId, isAgentCreated);
  }

  isAgentTab(tabId: number): boolean {
    return this.state.agentTabs.includes(tabId);
  }

  async refContext(tabId: number): Promise<{ slot: number; idBase: number }> {
    const slot = await this.slotOf(tabId);
    return { slot, idBase: this.state.nextId[tabId] ?? 1 };
  }

  noteNextId(tabId: number, nextId: number | undefined): void {
    if (!nextId || nextId <= (this.state.nextId[tabId] ?? 1)) return;
    this.state.nextId[tabId] = nextId;
    this.save();
  }

  // Remembers this snapshot's refs and returns the ones that were not in the last one.
  markSnapshot(tabId: number, refs: string[]): Set<string> {
    const previous = new Set(this.state.lastRefs[tabId] ?? []);
    this.state.lastRefs[tabId] = refs;
    this.save();
    return previous.size === 0 ? new Set() : new Set(refs.filter((r) => !previous.has(r)));
  }

  async listTabs(): Promise<{ slot: number; title: string; url: string; active: boolean; isBigFish: boolean }[]> {
    const all = await browser.tabs.query({});
    const result = [];
    for (const tab of all) {
      if (tab.id === undefined) continue;
      result.push({
        slot: await this.slotOf(tab.id),
        title: tab.title || "Untitled",
        url: tab.url || "",
        active: !!tab.active,
        isBigFish: this.isAgentTab(tab.id),
      });
    }
    return result.sort((a, b) => a.slot - b.slot);
  }

  async openInBigFishGroup(url: string): Promise<Tab> {
    const tab = await browser.tabs.create({ url, active: true });
    if (tab.id === undefined) return tab;
    await this.slotOf(tab.id, true);
    try {
      const [group] = await browser.tabGroups.query({ title: "BigFish" });
      if (group) {
        await browser.tabs.group({ tabIds: tab.id, groupId: group.id });
      } else {
        const groupId = await browser.tabs.group({ tabIds: tab.id });
        await browser.tabGroups.update(groupId, { title: "BigFish", color: "blue" });
      }
    } catch (e) {
      console.warn("[BigFish Tabs] Could not add to tab group", e);
    }
    return tab;
  }

  private findSlot(tabId: number): number | undefined {
    for (const [slot, id] of Object.entries(this.state.slots)) if (id === tabId) return Number(slot);
    return undefined;
  }

  private async forget(tabId: number): Promise<void> {
    await this.ready;
    const slot = this.findSlot(tabId);
    if (slot !== undefined) delete this.state.slots[slot];
    delete this.state.nextId[tabId];
    delete this.state.lastRefs[tabId];
    this.state.agentTabs = this.state.agentTabs.filter((id) => id !== tabId);
    this.save();
  }

  private save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void browser.storage.session.set({ [STORAGE_KEY]: this.state }).catch(() => {});
    }, 200);
  }
}

export const tabsManager = new TabManager();
