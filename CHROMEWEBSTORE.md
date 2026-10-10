# PRATYAKSHA — Chrome Web Store Listing & Compliance Metadata

**Codename**: PRATYAKSHA (प्रत्यक्ष)  
**Version**: 1.0.0  
**Project**: Sovereign Visual Perception & Privacy Shield for Browser Agents  

---

## 1. Store Listing Copy

### Extension Name
`PRATYAKSHA — Privacy-First Browser Agent`

### Short Description (max 132 chars)
`On-device visual perception & privacy shield for browser automation. All sensitive PII stays local in transient memory.`

### Detailed Description
PRATYAKSHA (प्रत्यक्ष) is a light-weight, sovereign privacy-first browser automation agent.

PRATYAKSHA solves the fundamental browser agent dilemma: enabling intelligent web automation without compromising user privacy or leaking sensitive Personally Identifiable Information (PII) to remote AI servers.

#### Key Features:
- 🔒 **100% On-Device Privacy Firewall**: Automatically detects and masks Indian Aadhaar (Verhoeff checksum validated), PAN Card numbers, Indian mobile numbers, and email addresses into client-side pseudonyms before reasoning.
- 🚀 **Hybrid Autonomous Planning**: Features a high-speed offline deterministic semantic action planner that executes tasks with zero external API calls or configuration, alongside an optional Gemini 2.0 Flash integration.
- 🎯 **Visual Bounding-Box HUD**: Visually highlights target elements on active webpages with an animated neon target box and action indicator badges.
- ⚖️ **"Show Your Work, Ask Before Acting" Cockpit**: Persistent Chrome Side Panel provides step-by-step approval, real-time audit logs, and instant cancellation controls.
- 🔓 **Just-In-Time Local Rehydration**: Rehydrates sensitive tokens strictly within the client-side DOM sandbox at the moment of execution; unmasked values never leave your browser.

---

## 2. Permissions Justification

Every permission requested in `manifest.json` adheres to the principle of least privilege:

| Permission | Justification for Chrome Web Store Reviewers |
|---|---|
| `activeTab` | Required to read the DOM structure of the webpage currently active in the user's browser window to identify interactive elements (buttons, search inputs, forms) upon user prompt. |
| `scripting` | Required to programmatically inject the target bounding-box highlighter stylesheet and synthetic DOM event dispatcher into the active tab. |
| `storage` | Required to persist user operational preferences (such as Step Approval mode toggle, privacy firewall strictness, and optional user-provided Gemini API key) securely in `chrome.storage.local`. |
| `sidePanel` | Required to provide the persistent agent cockpit and real-time execution HUD docked alongside the user's browsing session without obstructing webpage contents. |
| `tabs` | Required to query the active tab's domain and title to verify whether the agent is operating on a supported HTTP/HTTPS page or a restricted browser page. |
| Host `<all_urls>` | Required so that the user can run browser automation tasks across arbitrary public and intranet websites they navigate to. |

---

## 3. Privacy & Data Use Disclosure

1. **Does this extension collect or transmit personal data?**
   **No.** PRATYAKSHA operates entirely on-device. All PII detection, Verhoeff checksum validation, and pseudonym substitution occur in transient browser memory.
2. **Where are passwords, authentication tokens, or personal identifiers stored?**
   They are never stored on disk or sent over the network. The session vault is strictly in-memory (`Map`) and resets immediately upon session close.
3. **Remote Server Communication**:
   Zero telemetry. Outbound network requests only occur if the user explicitly configures their own personal Google Gemini API key in the extension settings.

---

## 4. Packaging & Publishing Readiness

- [x] Manifest Version: MV3 compliant
- [x] Valid PNG icons generated in dimensions 16x16, 48x48, 128x128
- [x] Background architecture: Non-persistent ES Module Service Worker
- [x] Persistent Side Panel configured via `chrome.sidePanel`
- [x] Zero external CDN scripts or dynamic `eval()` execution
