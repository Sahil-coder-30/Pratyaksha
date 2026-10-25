// Shared test setup: fake Google, JWTs, tickets and fake extensions for a test server.
import type { AuthConfig } from "../src/auth/config.js";
import { GoogleTokenError } from "../src/auth/google.js";
import { issueUserJwt } from "../src/auth/jwt.js";
import type { SessionRegistry } from "../src/mcp/registry.js";
import { startFakeExtension, ticketUrl, withOrigin, type FakeExtensionOptions } from "../scripts/fake-extension.js";

// Short timings so failure paths finish fast.
export const TUNING = { helloTimeoutMs: 300, heartbeatIntervalMs: 100, heartbeatDeadlineMs: 500 };
export const ORIGIN = "chrome-extension://test-extension-id";
export const USER = "google:user-1";
export const OriginWebSocket = withOrigin(ORIGIN);

// Fake Google: "good-<sub>" is a valid token for user <sub>, anything else is rejected.
export const auth: AuthConfig = {
  jwtSecret: new TextEncoder().encode("test-secret-test-secret-test-secret"),
  extensionOrigin: ORIGIN,
  verifyGoogleToken: async (accessToken) => {
    if (!accessToken.startsWith("good-")) throw new GoogleTokenError("bad token");
    const sub = accessToken.slice(5);
    return { sub, email: `${sub}@example.com` };
  },
};

export async function jwtFor(userId: string): Promise<string> {
  return (await issueUserJwt(auth.jwtSecret, { userId, email: `${userId}@example.com` })).token;
}

export async function waitFor<T>(fn: () => T | undefined, timeoutMs = 2_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = fn();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}

export function textOf(result: { content: unknown }): string {
  const blocks = result.content as Array<{ type: string; text?: string }>;
  return blocks.map((b) => b.text ?? "").join("");
}

// Helpers bound to one running test server.
export function testBed(server: () => { port: number; registry: SessionRegistry }) {
  const httpUrl = () => `http://127.0.0.1:${server().port}`;
  const urlFor = async (userId = USER) => ticketUrl(httpUrl(), await jwtFor(userId));

  async function fake(opts: Omit<FakeExtensionOptions, "url"> & { userId?: string } = {}) {
    const { userId, ...rest } = opts;
    return startFakeExtension({
      url: await urlFor(userId),
      origin: ORIGIN,
      heartbeatIntervalMs: TUNING.heartbeatIntervalMs,
      heartbeatDeadlineMs: TUNING.heartbeatDeadlineMs,
      ...rest,
    });
  }

  const session = (deviceId: string, userId = USER) => waitFor(() => server().registry.get(userId, deviceId));

  return { httpUrl, urlFor, fake, session };
}
