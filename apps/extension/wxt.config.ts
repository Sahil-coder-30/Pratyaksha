import { defineConfig } from "wxt";

// Function form: WXT loads .env files after reading this config, so env values
// are only ready when the manifest is built.
export default defineConfig({
  // Visible folder (Finder hides .output). Load dist/chrome-mv3 as unpacked.
  outDir: "dist",
  manifest: () => {
    // Public key only (base64, no PEM header). It fixes the extension ID that the
    // Google OAuth client and the server's EXTENSION_ID point at.
    const key = process.env.WXT_EXTENSION_KEY;
    // OAuth client of type "Chrome Extension" for that extension ID.
    const clientId = process.env.WXT_GOOGLE_CLIENT_ID;
    if (!key || !clientId) {
      console.warn("[BigFish] WXT_EXTENSION_KEY or WXT_GOOGLE_CLIENT_ID is not set. Google sign-in will not work.");
    }

    return {
      name: "BigFish: Private Browser for Any Agent",
      description: "Expose your real browser to AI agents over MCP, with PII kept local.",
      minimum_chrome_version: "116",
      permissions: ["tabs", "activeTab", "scripting", "storage", "sidePanel", "tabGroups", "alarms", "identity"],
      host_permissions: ["<all_urls>"],
      icons: {
        "16": "icon/icon-16.png",
        "32": "icon/icon-32.png",
        "48": "icon/icon-48.png",
        "128": "icon/icon-128.png",
      },
      action: {
        default_title: "BigFish",
        default_icon: {
          "16": "icon/icon-16.png",
          "32": "icon/icon-32.png",
          "48": "icon/icon-48.png",
          "128": "icon/icon-128.png",
        },
      },
      ...(key ? { key } : {}),
      ...(clientId ? { oauth2: { client_id: clientId, scopes: ["openid", "email", "profile"] } } : {}),
    };
  },
});
