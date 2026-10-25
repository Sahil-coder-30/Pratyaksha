// Auth settings from env. Production needs all three values. Dev mode
// (ENABLE_DEV_ROUTES=1) can start without them, with weaker checks and a warning.
import { randomBytes } from "node:crypto";
import { googleTokenVerifier, type GoogleVerifier } from "./google.js";

export interface AuthConfig {
  jwtSecret: Uint8Array;
  // Unset: POST /api/auth/google answers 503.
  verifyGoogleToken?: GoogleVerifier;
  // chrome-extension://<EXTENSION_ID>. Unset (dev only): any Origin may open /mcp-ws.
  extensionOrigin?: string;
}

const MIN_SECRET_LENGTH = 32;

export function authConfigFromEnv(env: NodeJS.ProcessEnv, opts: { dev: boolean }): AuthConfig {
  const missing: string[] = [];
  const secret = env.JWT_SECRET ?? "";
  const clientId = env.GOOGLE_EXTENSION_CLIENT_ID;
  const extensionId = env.EXTENSION_ID;
  if (secret.length < MIN_SECRET_LENGTH) missing.push(`JWT_SECRET (min ${MIN_SECRET_LENGTH} chars)`);
  if (!clientId) missing.push("GOOGLE_EXTENSION_CLIENT_ID");
  if (!extensionId) missing.push("EXTENSION_ID");

  if (missing.length > 0) {
    if (!opts.dev) throw new Error(`Missing auth config: ${missing.join(", ")}`);
    console.warn(`[BigFish] dev mode, missing auth config: ${missing.join(", ")}. Login and Origin checks are relaxed.`);
  }

  return {
    // Dev without a secret: a random one, so tokens die on restart.
    jwtSecret: new TextEncoder().encode(secret.length >= MIN_SECRET_LENGTH ? secret : randomBytes(32).toString("hex")),
    verifyGoogleToken: clientId ? googleTokenVerifier(clientId) : undefined,
    extensionOrigin: extensionId ? `chrome-extension://${extensionId}` : undefined,
  };
}
