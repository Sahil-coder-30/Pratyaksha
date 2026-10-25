// Server address and extension identity, shared by auth and the connection.
import { WS_PATH } from "@bigfish/contracts";

export const SERVER_URL: string = import.meta.env.WXT_SERVER_URL || "http://127.0.0.1:8787";
export const WS_URL = `${SERVER_URL.replace(/^http/, "ws")}${WS_PATH}`;
export const EXT_VERSION = browser.runtime.getManifest().version;
// The local ML privacy daemon (ML/). It runs on this machine; screenshots never go to a remote host.
export const ML_URL: string = import.meta.env.WXT_ML_URL || "http://127.0.0.1:8788";

const DEVICE_ID_KEY = "bigfish.deviceId";

// One random ID per install, kept in local storage. Survives browser restarts.
export async function getDeviceId(): Promise<string> {
  const stored = await browser.storage.local.get(DEVICE_ID_KEY);
  const existing = stored[DEVICE_ID_KEY];
  if (typeof existing === "string") return existing;
  const deviceId = crypto.randomUUID();
  await browser.storage.local.set({ [DEVICE_ID_KEY]: deviceId });
  return deviceId;
}
