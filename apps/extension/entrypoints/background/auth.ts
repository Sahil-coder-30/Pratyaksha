// Google login. Chrome's identity API gives a Google access token (Chrome caches
// and refreshes it), and the server trades it for a 1 hour BigFish JWT.
// The JWT lives in chrome.storage.session: memory only, readable by the service
// worker and the side panel, gone when the browser closes.
import { SERVER_URL } from "./config.js";

export interface AuthState {
  token: string;
  expiresAt: number;
  email: string;
}

// The user has to sign in (or signed out on purpose).
export class SignInRequiredError extends Error {}

const SESSION_KEY = "bigfish.auth";
// Set by signOut, so alarms and reconnects do not sign the user back in silently.
const SIGNED_OUT_KEY = "bigfish.signedOut";
// Get a new JWT this long before the old one expires.
const EXPIRY_MARGIN_MS = 60_000;

let pending: Promise<AuthState> | null = null;

// Valid JWT from storage, or a fresh one without any UI.
export async function getAuth(): Promise<AuthState> {
  const stored = await readStored();
  if (stored && stored.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return stored;
  const local = await browser.storage.local.get(SIGNED_OUT_KEY);
  if (local[SIGNED_OUT_KEY]) throw new SignInRequiredError("Signed out.");
  pending ??= login(false).finally(() => (pending = null));
  return pending;
}

// From a user click: may show Google's account chooser.
export async function signIn(): Promise<AuthState> {
  await browser.storage.local.remove(SIGNED_OUT_KEY);
  return login(true);
}

export async function signOut(): Promise<void> {
  await browser.storage.local.set({ [SIGNED_OUT_KEY]: true });
  await browser.storage.session.remove(SESSION_KEY);
  try {
    const { token } = await browser.identity.getAuthToken({ interactive: false });
    if (token) await browser.identity.removeCachedAuthToken({ token });
  } catch {
    // No cached Google token.
  }
}

// The server refused our JWT. Drop it so the next getAuth() fetches a new one.
export async function dropJwt(): Promise<void> {
  await browser.storage.session.remove(SESSION_KEY);
}

export async function currentEmail(): Promise<string | null> {
  return (await readStored())?.email ?? null;
}

async function readStored(): Promise<AuthState | undefined> {
  const stored = await browser.storage.session.get(SESSION_KEY);
  return stored[SESSION_KEY] as AuthState | undefined;
}

async function login(interactive: boolean): Promise<AuthState> {
  let accessToken = await googleToken(interactive);
  let res = await exchange(accessToken);
  if (res.status === 401) {
    // Chrome's cached Google token may be revoked. Drop it and try once more.
    await browser.identity.removeCachedAuthToken({ token: accessToken });
    accessToken = await googleToken(interactive);
    res = await exchange(accessToken);
  }
  const body = (await res.json().catch(() => ({}))) as Partial<AuthState> & { ok?: boolean; message?: string };
  if (!res.ok || !body.token || !body.expiresAt || !body.email) {
    throw new Error(`Login failed (${res.status}): ${body.message ?? "unknown error"}`);
  }
  const auth: AuthState = { token: body.token, expiresAt: body.expiresAt, email: body.email };
  await browser.storage.session.set({ [SESSION_KEY]: auth });
  return auth;
}

async function googleToken(interactive: boolean): Promise<string> {
  try {
    const { token } = await browser.identity.getAuthToken({ interactive });
    if (token) return token;
  } catch (err) {
    if (interactive) throw err;
  }
  throw new SignInRequiredError("Sign in with Google to connect.");
}

function exchange(accessToken: string): Promise<Response> {
  return fetch(`${SERVER_URL}/api/auth/google`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken }),
  });
}
