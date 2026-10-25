// BigFish PII Vault: Tokenizes private data before it ever leaves the browser.
// Replaces emails, phones, Aadhaar, PAN, SSN, Credit Cards with [TYPE_XXXX] tokens.

// Token kinds the vault hands out. NAME and ADDRESS come from masked screenshots.
const TOKEN_KINDS = "EMAIL|PHONE|AADHAAR|PAN|CARD|SSN|SECRET|NAME|ADDRESS";

// A fresh global regex for vault tokens like [EMAIL_7F3A].
export function vaultTokenRegex(): RegExp {
  return new RegExp(`\\[(${TOKEN_KINDS})_[0-9A-F]{4}\\]`, "g");
}

export interface VaultToken {
  token: string;
  type: string;
  value: string;
  origins: Set<string>;
  fromUser?: boolean;
  createdAt: number;
}

class PiiVault {
  private tokens: Map<string, VaultToken> = new Map();
  private valueToToken: Map<string, string> = new Map();
  private readyPromise: Promise<void>;
  private persistDebounceTimer: any = null;

  constructor() {
    this.readyPromise = this.loadFromStorage();
  }

  async ready(): Promise<void> {
    return this.readyPromise;
  }

  private hashValue(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).toUpperCase().padStart(4, "0").slice(0, 4);
  }

  tokenize(type: string, value: string, origin: string, fromUser: boolean = false): string {
    const trimmed = value.trim();
    if (!trimmed) return value;

    const existingToken = this.valueToToken.get(trimmed);
    if (existingToken) {
      const entry = this.tokens.get(existingToken);
      if (entry) {
        entry.origins.add(origin);
        this.schedulePersist();
        return existingToken;
      }
    }

    const shortId = this.hashValue(`${type}:${trimmed}:${Date.now()}`);
    const token = `[${type.toUpperCase()}_${shortId}]`;

    const entry: VaultToken = {
      token,
      type,
      value: trimmed,
      origins: new Set([origin]),
      fromUser,
      createdAt: Date.now(),
    };

    this.tokens.set(token, entry);
    this.valueToToken.set(trimmed, token);
    this.schedulePersist();
    return token;
  }

  detokenize(token: string): VaultToken | undefined {
    return this.tokens.get(token);
  }

  rehydrateText(text: string, currentOrigin: string): { text: string; crossOrigins: string[] } {
    let result = text;
    const crossOrigins: string[] = [];

    result = result.replace(vaultTokenRegex(), (match) => {
      const entry = this.tokens.get(match);
      if (!entry) return match;
      if (!entry.origins.has(currentOrigin)) {
        crossOrigins.push(...Array.from(entry.origins));
      }
      return entry.value;
    });

    return { text: result, crossOrigins: Array.from(new Set(crossOrigins)) };
  }

  toJSON(): string {
    const list: any[] = [];
    for (const entry of this.tokens.values()) {
      list.push({
        ...entry,
        origins: Array.from(entry.origins),
      });
    }
    return JSON.stringify(list);
  }

  fromJSON(jsonStr: string): void {
    try {
      const list = JSON.parse(jsonStr);
      if (!Array.isArray(list)) return;
      this.tokens.clear();
      this.valueToToken.clear();
      for (const item of list) {
        const entry: VaultToken = {
          token: item.token,
          type: item.type,
          value: item.value,
          origins: new Set(item.origins || []),
          fromUser: item.fromUser,
          createdAt: item.createdAt || Date.now(),
        };
        this.tokens.set(entry.token, entry);
        this.valueToToken.set(entry.value, entry.token);
      }
    } catch (e) {
      console.error("[BigFish Vault] Failed to load JSON", e);
    }
  }

  private schedulePersist(): void {
    if (this.persistDebounceTimer) clearTimeout(this.persistDebounceTimer);
    this.persistDebounceTimer = setTimeout(() => {
      this.saveToStorage();
    }, 400);
  }

  private async saveToStorage(): Promise<void> {
    const session = sessionStorageArea();
    if (session) {
      try {
        await session.set({ bigfish_pii_vault: this.toJSON() });
      } catch (err) {
        console.warn("[BigFish Vault] storage.session set failed", err);
      }
    }
  }

  private async loadFromStorage(): Promise<void> {
    const session = sessionStorageArea();
    if (session) {
      try {
        const data = await session.get("bigfish_pii_vault");
        if (data && data.bigfish_pii_vault) {
          this.fromJSON(data.bigfish_pii_vault);
        }
      } catch (err) {
        console.warn("[BigFish Vault] storage.session get failed", err);
      }
    }
  }
}

// chrome.storage.session in the extension; absent in unit tests (Node).
function sessionStorageArea(): { get(key: string): Promise<any>; set(items: object): Promise<void> } | undefined {
  return (globalThis as any).chrome?.storage?.session;
}

export const vault = new PiiVault();
