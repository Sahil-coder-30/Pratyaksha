// BigFish session JWT: HS256, 1 hour, no refresh token. On expiry the
// extension asks Chrome for a fresh Google token and logs in again.
import { SignJWT, jwtVerify } from "jose";

export const JWT_TTL_SECONDS = 60 * 60;
const ISSUER = "bigfish";
const AUDIENCE = "bigfish-extension";

export interface UserClaims {
  userId: string;
  email: string;
}

export async function issueUserJwt(secret: Uint8Array, claims: UserClaims): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS;
  const token = await new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret);
  return { token, expiresAt: expiresAt * 1000 };
}

// Throws if the token is invalid or expired.
export async function verifyUserJwt(secret: Uint8Array, token: string): Promise<UserClaims> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") throw new Error("token missing claims");
  return { userId: payload.sub, email: payload.email };
}
