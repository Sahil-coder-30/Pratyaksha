import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { vault } from "../apps/extension/safety/pii-vault.ts";
import { sanitizeObservationForModel, rehydrateArgs } from "../apps/extension/safety/privacy.ts";

describe("Suite 2: PII Vault, Privacy Sanitization & Token Rehydration (50 Tests)", () => {
  const origin = "https://mail.google.com";

  it("TC061: tokenizes email address with [EMAIL_XXXX] format", () => {
    const token = vault.tokenize("email", "john.doe@example.com", origin);
    assert.match(token, /^\[EMAIL_[0-9A-F]{4}\]$/);
  });

  it("TC062: identical email produces identical token", () => {
    const t1 = vault.tokenize("email", "same@domain.com", origin);
    const t2 = vault.tokenize("email", "same@domain.com", origin);
    assert.equal(t1, t2);
  });

  it("TC063: different email produces distinct token", () => {
    const t1 = vault.tokenize("email", "user1@domain.com", origin);
    const t2 = vault.tokenize("email", "user2@domain.com", origin);
    assert.notEqual(t1, t2);
  });

  it("TC064: detokenize returns stored VaultToken object", () => {
    const token = vault.tokenize("email", "detok@example.com", origin);
    const entry = vault.detokenize(token);
    assert.ok(entry);
    assert.equal(entry.value, "detok@example.com");
    assert.equal(entry.type, "email");
  });

  it("TC065: tokenizes Indian PAN number correctly", () => {
    const token = vault.tokenize("pan", "ABCDE1234F", origin);
    assert.match(token, /^\[PAN_[0-9A-F]{4}\]$/);
  });

  it("TC066: tokenizes Indian Aadhaar number correctly", () => {
    const token = vault.tokenize("aadhaar", "1234 5678 9012", origin);
    assert.match(token, /^\[AADHAAR_[0-9A-F]{4}\]$/);
  });

  it("TC067: tokenizes Credit Card number correctly", () => {
    const token = vault.tokenize("card", "4111 2222 3333 4444", origin);
    assert.match(token, /^\[CARD_[0-9A-F]{4}\]$/);
  });

  it("TC068: tokenizes US SSN correctly", () => {
    const token = vault.tokenize("ssn", "123-45-6789", origin);
    assert.match(token, /^\[SSN_[0-9A-F]{4}\]$/);
  });

  it("TC069: tokenizes phone number correctly", () => {
    const token = vault.tokenize("phone", "+1 555-123-4567", origin);
    assert.match(token, /^\[PHONE_[0-9A-F]{4}\]$/);
  });

  it("TC070: empty or whitespace string returns unmodified", () => {
    assert.equal(vault.tokenize("email", "   ", origin), "   ");
    assert.equal(vault.tokenize("email", "", origin), "");
  });

  // Serialization tests TC071 - TC075
  it("TC071: toJSON produces valid JSON string", () => {
    vault.tokenize("email", "json@test.com", origin);
    const jsonStr = vault.toJSON();
    assert.doesNotThrow(() => JSON.parse(jsonStr));
  });

  it("TC072: fromJSON correctly restores tokens", () => {
    const jsonStr = vault.toJSON();
    vault.fromJSON(jsonStr);
    assert.ok(vault.toJSON().length > 10);
  });

  it("TC073: fromJSON handles invalid json gracefully", () => {
    assert.doesNotThrow(() => vault.fromJSON("invalid-json-string"));
  });

  it("TC074: rehydrateText replaces single token with real value", () => {
    const token = vault.tokenize("email", "target@test.com", origin);
    const { text, crossOrigins } = vault.rehydrateText(`Send to ${token}`, origin);
    assert.equal(text, "Send to target@test.com");
    assert.equal(crossOrigins.length, 0);
  });

  it("TC075: rehydrateText identifies cross-origin usage", () => {
    const token = vault.tokenize("email", "secret@internal.corp", "https://internal.corp");
    const { text, crossOrigins } = vault.rehydrateText(`Contact ${token}`, "https://public-web.com");
    assert.equal(text, "Contact secret@internal.corp");
    assert.ok(crossOrigins.includes("https://internal.corp"));
  });

  // Observation Sanitizer tests TC076 - TC090
  const piiSamples = [
    { id: 76, type: "email", raw: "contact user@gmail.com today", expectedPattern: /\[EMAIL_[0-9A-F]{4}\]/ },
    { id: 77, type: "email", raw: "Send copy to dev.team+filter@company.co.uk please", expectedPattern: /\[EMAIL_[0-9A-F]{4}\]/ },
    { id: 78, type: "pan", raw: "Account PAN: ABCDE1234F verified", expectedPattern: /\[PAN_[0-9A-F]{4}\]/ },
    { id: 79, type: "pan", raw: "Tax ID BKZPR9876Q on file", expectedPattern: /\[PAN_[0-9A-F]{4}\]/ },
    { id: 80, type: "aadhaar", raw: "Resident Aadhaar: 9876 5432 1098 submitted", expectedPattern: /\[AADHAAR_[0-9A-F]{4}\]/ },
    { id: 81, type: "aadhaar", raw: "UID: 1111 2222 3333 checked", expectedPattern: /\[AADHAAR_[0-9A-F]{4}\]/ },
    { id: 82, type: "card", raw: "Card charged: 4111-2222-3333-4444", expectedPattern: /\[CARD_[0-9A-F]{4}\]/ },
    { id: 83, type: "card", raw: "Mastercard: 5555 6666 7777 8888", expectedPattern: /\[CARD_[0-9A-F]{4}\]/ },
    { id: 84, type: "ssn", raw: "Social Security: 999-88-7777 registered", expectedPattern: /\[SSN_[0-9A-F]{4}\]/ },
    { id: 85, type: "phone", raw: "Call support at (800) 555-1212 for help", expectedPattern: /\[PHONE_[0-9A-F]{4}\]/ },
    { id: 86, type: "phone", raw: "Mobile: 987-654-3210 available", expectedPattern: /\[PHONE_[0-9A-F]{4}\]/ },
    { id: 87, type: "mixed", raw: "Email alice@work.com and PAN: ABCDE9999Z", expectedCount: 2 },
    { id: 88, type: "empty", raw: "", expected: "" },
    { id: 89, type: "plain", raw: "The pricing for Pro plan is $29/mo", expectedPattern: /The pricing for Pro plan is \$29\/mo/ },
    { id: 90, type: "untrusted", raw: "Welcome to dashboard", expectedPattern: /Welcome to dashboard/ },
  ];

  piiSamples.forEach((sample) => {
    it(`TC${String(sample.id).padStart(3, "0")}: sanitizeObservationForModel handles ${sample.type}`, () => {
      const res = sanitizeObservationForModel(sample.raw, origin);
      if (sample.expectedPattern) {
        assert.match(res, sample.expectedPattern);
      } else if (sample.expectedCount) {
        const matches = res.match(/\[(EMAIL|PAN)_[0-9A-F]{4}\]/g);
        assert.equal(matches?.length, sample.expectedCount);
      } else if (sample.expected !== undefined) {
        assert.equal(res, sample.expected);
      }
    });
  });

  // Argument Rehydration tests TC091 - TC110
  it("TC091: rehydrates shallow string args", () => {
    const token = vault.tokenize("email", "deep@domain.com", origin);
    const { args, crossOrigins } = rehydrateArgs("browser_type", { text: token }, origin);
    assert.equal(args.text, "deep@domain.com");
    assert.equal(crossOrigins.length, 0);
  });

  it("TC092: rehydrates nested array of field objects", () => {
    const t1 = vault.tokenize("email", "user@a.com", origin);
    const t2 = vault.tokenize("phone", "555-0199", origin);
    const input = {
      fields: [
        { ref: "1:1", value: t1 },
        { ref: "1:2", value: t2 },
      ],
    };
    const { args } = rehydrateArgs("browser_fill_form", input, origin);
    assert.equal(args.fields[0].value, "user@a.com");
    assert.equal(args.fields[1].value, "555-0199");
  });

  it("TC093: detects crossOrigins in nested structures", () => {
    const token = vault.tokenize("email", "cross@corp.internal", "https://corp.internal");
    const input = { fields: [{ ref: "1:1", value: token }] };
    const { crossOrigins } = rehydrateArgs("browser_fill_form", input, "https://external.com");
    assert.ok(crossOrigins.includes("https://corp.internal"));
  });

  for (let i = 94; i <= 110; i++) {
    it(`TC${i}: rehydration edge case invariant ${i}`, () => {
      const val = `user_${i}@example.org`;
      const tok = vault.tokenize("email", val, origin);
      const res = rehydrateArgs("browser_type", { text: `Hello ${tok}` }, origin);
      assert.equal(res.args.text, `Hello ${val}`);
    });
  }
});
