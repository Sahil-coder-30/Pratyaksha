// BigFish URL Policy: prevents agents from navigating to privileged or unsafe URLs.

const FORBIDDEN_SCHEMES = ["chrome:", "chrome-extension:", "edge:", "about:", "file:", "data:", "javascript:"];
const FORBIDDEN_HOSTS = ["chromewebstore.google.com", "chrome.google.com"];

export function isForbiddenUrl(urlStr: string): boolean {
  if (!urlStr || !urlStr.trim()) return true;
  const trimmed = urlStr.trim().toLowerCase();

  for (const scheme of FORBIDDEN_SCHEMES) {
    if (trimmed.startsWith(scheme)) {
      return true;
    }
  }

  try {
    const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    for (const host of FORBIDDEN_HOSTS) {
      if (parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}
