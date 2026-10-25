import { vault, vaultTokenRegex } from "./pii-vault.ts";

// PII patterns. Each one must not fire on ids inside URLs or long digit runs,
// so checksums are used where the format has one (cards: Luhn, Aadhaar: Verhoeff).
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Separated groups like +91 98765 43210, (415) 555-0134, 415-555-0134, or a bare Indian mobile.
const PHONE_REGEX =
  /(?<![\w/=?&#.:%-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4}|\d{5}\s\d{5}|[6-9]\d{9})(?![\w/=&#-])/g;
const PAN_REGEX = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const AADHAAR_REGEX = /(?<![\d-])[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?![\d-])/g;
// 15-16 digits (Visa, Mastercard, Amex, RuPay), not inside a URL or a longer number.
const CARD_REGEX = /(?<![\w/=?&#.:%-])\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{3,4}(?![\w-])/g;
const SSN_REGEX = /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g;

// URLs must never be tokenized or sanitized, as the agent must navigate to and test them directly.
const URL_REGEX = /\bhttps?:\/\/[^\s<>"'{}|\\^`]+|\bwww\.[^\s<>"'{}|\\^`]+/gi;

export function sanitizeObservationForModel(text: string, origin: string): string {
  if (!text) return text;

  // Protect all URLs so links, navigation targets, and test endpoints are never mangled by PII regexes.
  const urlMap: Map<string, string> = new Map();
  let counter = 0;
  let sanitized = text.replace(URL_REGEX, (url) => {
    const placeholder = `__BIGFISH_PRESERVED_URL_${counter++}__`;
    urlMap.set(placeholder, url);
    return placeholder;
  });

  sanitized = sanitized.replace(EMAIL_REGEX, (match) => vault.tokenize("email", match, origin));
  sanitized = sanitized.replace(PAN_REGEX, (match) => vault.tokenize("pan", match, origin));
  sanitized = sanitized.replace(CARD_REGEX, (match) => (luhnValid(match) ? vault.tokenize("card", match, origin) : match));
  sanitized = sanitized.replace(AADHAAR_REGEX, (match) => (verhoeffValid(match) ? vault.tokenize("aadhaar", match, origin) : match));
  sanitized = sanitized.replace(SSN_REGEX, (match) => vault.tokenize("ssn", match, origin));
  sanitized = sanitized.replace(PHONE_REGEX, (match) => vault.tokenize("phone", match, origin));

  // Restore protected URLs untouched.
  for (const [placeholder, originalUrl] of urlMap.entries()) {
    sanitized = sanitized.replace(placeholder, originalUrl);
  }

  return sanitized;
}

// ML daemon category -> vault kind for masked screenshots. The token is [KIND_XXXX].
const SCREENSHOT_KIND: Record<string, string> = {
  EMAIL: "email",
  PHONE: "phone",
  AADHAAR: "aadhaar",
  PAN: "pan",
  CREDIT_CARD: "card",
  SSN: "ssn",
  PERSON: "name",
  ADDRESS: "address",
  PASSWORD: "secret",
  CREDENTIAL: "secret",
};

// The label painted over one private spot in a screenshot. A value with text
// goes into the vault, the same way the text filter stores it, so the model
// can type the token later. Spots without text (a face in a photo) get a fixed
// label that rehydrates to nothing.
export function screenshotPlaceholder(region: { category: string; text?: string | null; sources?: string[] }, origin: string): string {
  const text = region.text?.trim();
  if (!text) return region.sources?.includes("cv") ? "[PHOTO]" : "[MASKED]";
  return vault.tokenize(SCREENSHOT_KIND[region.category] ?? "secret", text, origin);
}

export function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

// Aadhaar numbers end in a Verhoeff check digit.
export function verhoeffValid(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 12) return false;
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![Number(digits[digits.length - 1 - i])]!]!;
  }
  return c === 0;
}

export function rehydrateArgs(
  tool: string,
  args: any,
  targetOrigin: string
): { args: any; crossOrigins: string[]; rehydrated: boolean; unknown: string[] } {
  if (!args || typeof args !== "object") {
    return { args, crossOrigins: [], rehydrated: false, unknown: [] };
  }

  const crossOriginsSet = new Set<string>();
  const cloned = JSON.parse(JSON.stringify(args));
  let rehydrated = false;

  function walkAndRehydrate(obj: any) {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === "string") {
        const { text, crossOrigins } = vault.rehydrateText(val, targetOrigin);
        if (text !== val) rehydrated = true;
        obj[key] = text;
        crossOrigins.forEach((o) => crossOriginsSet.add(o));
      } else if (val && typeof val === "object") {
        walkAndRehydrate(val);
      }
    }
  }

  walkAndRehydrate(cloned);
  // A token still there after rehydration is not in the vault: the model made it up.
  const unknown = [...new Set(JSON.stringify(cloned).match(vaultTokenRegex()) ?? [])];
  return { args: cloned, crossOrigins: Array.from(crossOriginsSet), rehydrated, unknown };
}
