// Verifies a Google access token from chrome.identity.getAuthToken() with
// Google's tokeninfo endpoint. The token must be issued to our Chrome
// extension OAuth client and carry a verified email.
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

export interface GoogleIdentity {
  sub: string;
  email: string;
}

export type GoogleVerifier = (accessToken: string) => Promise<GoogleIdentity>;

export class GoogleTokenError extends Error {}

interface TokenInfo {
  aud?: string;
  azp?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  exp?: string;
}

export function googleTokenVerifier(clientId: string, fetchImpl: typeof fetch = fetch): GoogleVerifier {
  return async (accessToken) => {
    // POST keeps the token out of URLs and access logs.
    const res = await fetchImpl(TOKENINFO_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: accessToken }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new GoogleTokenError(`tokeninfo returned ${res.status}`);
    const info = (await res.json()) as TokenInfo;

    if (info.aud !== clientId && info.azp !== clientId) throw new GoogleTokenError("token not issued to this client");
    if (!info.sub || !info.email) throw new GoogleTokenError("token has no sub or email");
    if (info.email_verified !== true && info.email_verified !== "true") throw new GoogleTokenError("email not verified");
    if (info.exp && Number(info.exp) * 1000 <= Date.now()) throw new GoogleTokenError("token expired");

    return { sub: info.sub, email: info.email };
  };
}
