import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isForbiddenUrl } from "../apps/extension/safety/url-policy.ts";
import { classifyAction } from "../apps/extension/safety/action-policy.ts";

describe("Suite 3: URL Policy & Action Risk Classification (50 Tests)", () => {
  // URL Policy tests (TC111 - TC135)
  const forbiddenUrls = [
    "chrome://settings",
    "chrome://flags",
    "chrome://extensions",
    "chrome-extension://abcdefg/manifest.json",
    "edge://settings",
    "about:blank",
    "about:config",
    "file:///C:/Users/secret.txt",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<h1>hack</h1>",
    "https://chromewebstore.google.com/detail/123",
    "http://chromewebstore.google.com",
    "https://chrome.google.com/webstore",
    "",
    "   ",
  ];

  forbiddenUrls.forEach((url, idx) => {
    const tcId = 111 + idx;
    it(`TC${tcId}: isForbiddenUrl correctly blocks forbidden URL: "${url}"`, () => {
      assert.equal(isForbiddenUrl(url), true);
    });
  });

  const allowedUrls = [
    "https://google.com",
    "https://mail.google.com/mail/u/0",
    "https://calendar.google.com",
    "https://en.wikipedia.org/wiki/Main_Page",
    "https://github.com/Coder-Aryan09/BigFish",
    "http://localhost:3000",
    "http://127.0.0.1:8787",
    "https://news.ycombinator.com",
    "https://acme.corp/pricing",
  ];

  allowedUrls.forEach((url, idx) => {
    const tcId = 111 + forbiddenUrls.length + idx;
    it(`TC${tcId}: isForbiddenUrl allows legitimate web URL: "${url}"`, () => {
      assert.equal(isForbiddenUrl(url), false);
    });
  });

  // Action Policy tests (TC136 - TC160)
  describe("Action Policy Classification", () => {
    it("TC136: crossOrigins flag mandates approval immediately", () => {
      const res = classifyAction("browser_click", { ref: "1:1" }, { crossOrigins: ["https://other.com"] });
      assert.equal(res.needsApproval, true);
      assert.match(res.reason || "", /(cross-origin|different origin)/i);
    });

    const riskyLabels = [
      "Send",
      "Send Message",
      "Pay Now",
      "Buy Pro",
      "Purchase License",
      "Delete Account",
      "Remove Item",
      "Destroy Database",
      "Submit Order",
      "Checkout",
      "Transfer Funds",
      "Authorize Transaction",
    ];

    riskyLabels.forEach((label, idx) => {
      const tcId = 137 + idx;
      it(`TC${tcId}: browser_click on sensitive button "${label}" requires approval`, () => {
        const res = classifyAction("browser_click", { ref: "2:5" }, { label });
        assert.equal(res.needsApproval, true);
        assert.match(res.reason || "", new RegExp(label, "i"));
      });
    });

    const safeLabels = [
      "Next Page",
      "View Details",
      "Expand",
      "Collapse",
      "Pricing",
      "Read More",
      "Help",
    ];

    safeLabels.forEach((label, idx) => {
      const tcId = 149 + idx;
      it(`TC${tcId}: browser_click on standard button "${label}" does NOT require approval`, () => {
        const res = classifyAction("browser_click", { ref: "2:5" }, { label });
        assert.equal(res.needsApproval, false);
      });
    });

    it("TC156: browser_type with submit:true on form with Send button needs approval", () => {
      const res = classifyAction("browser_type", { submit: true }, { formSubmitLabel: "Send" });
      assert.equal(res.needsApproval, true);
    });

    it("TC157: browser_type with submit:true on Search box is EXEMPT from approval", () => {
      const res = classifyAction("browser_type", { submit: true }, { formSubmitLabel: "Submit", isSearch: true });
      assert.equal(res.needsApproval, false);
    });

    it("TC158: browser_press_key Enter on form with Pay button needs approval", () => {
      const res = classifyAction("browser_press_key", { key: "Enter" }, { formSubmitLabel: "Pay $50" });
      assert.equal(res.needsApproval, true);
    });

    it("TC159: browser_press_key Tab does not require approval", () => {
      const res = classifyAction("browser_press_key", { key: "Tab" }, { formSubmitLabel: "Pay $50" });
      assert.equal(res.needsApproval, false);
    });

    it("TC160: browser_fill_form with submit_ref on Delete button requires approval", () => {
      const res = classifyAction("browser_fill_form", { submit_ref: "1:9" }, { formSubmitLabel: "Delete" });
      assert.equal(res.needsApproval, true);
    });
  });
});
