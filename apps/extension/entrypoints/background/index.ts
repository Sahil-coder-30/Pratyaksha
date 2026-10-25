// BigFish service worker: Google login, the MCP connection to the server,
// tab tracking, side panel behavior, and approvals.
import { tabsManager } from "./tabs.js";
import { currentEmail, getAuth, signIn, signOut } from "./auth.js";
import { SERVER_URL, getDeviceId } from "./config.js";
import { Connection } from "./conn/connection.js";
import { approvals } from "../../safety/approval.js";

// Wakes the service worker, so a dropped connection comes back even if Chrome
// stopped the worker while it was waiting in backoff.
const KEEPALIVE_ALARM = "bigfish-keepalive";

export default defineBackground(() => {
  console.log("[BigFish] service worker started");

  const connection = new Connection((status) => {
    console.log("[BigFish] connection", status.state, status.detail ?? "");
    browser.runtime.sendMessage({ type: "BIGFISH_CONN_STATUS", status }).catch(() => {
      // Side panel not open.
    });
  });

  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // Listeners first: MV3 only delivers events to listeners added synchronously at startup.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) connection.ensureConnected();
  });
  browser.runtime.onStartup.addListener(() => connection.ensureConnected());
  browser.runtime.onInstalled.addListener(() => connection.ensureConnected());
  void browser.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  connection.ensureConnected();

  // Tab tracking
  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id) tabsManager.registerTab(tab.id);
  });

  // Approval requests go to the side panel. With no panel open, a small popup asks instead.
  const approvalPopups = new Map<string, number>();
  approvals.onApprovalRequested((req) => {
    browser.runtime.sendMessage({ type: "BIGFISH_APPROVAL_REQUEST", payload: req }).catch(async () => {
      const popup = await browser.windows.create({
        url: browser.runtime.getURL(`/sidepanel.html?approvalId=${encodeURIComponent(req.id)}`),
        type: "popup",
        width: 420,
        height: 360,
      });
      if (popup?.id !== undefined) approvalPopups.set(req.id, popup.id);
    });
  });
  approvals.onApprovalClosed((id) => {
    browser.runtime.sendMessage({ type: "BIGFISH_APPROVAL_CLOSED", id }).catch(() => {});
    const windowId = approvalPopups.get(id);
    approvalPopups.delete(id);
    if (windowId !== undefined) void browser.windows.remove(windowId).catch(() => {});
  });

  // Messages from the side panel. Async handlers answer through sendResponse.
  browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    const reply = (work: Promise<unknown>) => {
      work.then(
        (value) => sendResponse({ ok: true, ...(value as object) }),
        (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
      return true;
    };

    switch (msg?.type) {
      case "RESOLVE_APPROVAL":
        sendResponse({ ok: approvals.resolveDecision(msg.id, msg.approved) });
        return false;
      case "BIGFISH_GET_APPROVAL":
        sendResponse({ ok: true, request: approvals.getPending(msg.id) ?? null });
        return false;
      case "KILL_SWITCH":
        return reply(connection.kill());
      case "BIGFISH_PANEL_OPENED":
        connection.ensureConnected();
        return reply(statusPayload());
      case "BIGFISH_GET_STATUS":
        return reply(statusPayload());
      case "BIGFISH_SIGN_IN":
        return reply(
          signIn().then(async () => {
            await connection.resume();
            return statusPayload();
          }),
        );
      case "BIGFISH_SIGN_OUT":
        connection.signedOut();
        return reply(signOut().then(statusPayload));
      case "BIGFISH_CONNECT":
        return reply(connection.resume().then(statusPayload));
      // What the side panel needs to call the agent API itself.
      case "BIGFISH_AGENT_CONTEXT":
        return reply(
          Promise.all([getAuth(), getDeviceId()]).then(([auth, deviceId]) => ({ token: auth.token, deviceId, serverUrl: SERVER_URL })),
        );
      default:
        return false;
    }
  });

  async function statusPayload() {
    return { status: connection.getStatus(), email: await currentEmail() };
  }
});
