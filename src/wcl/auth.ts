import { requireWclCredentials } from "../config/env.js";

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let cache: TokenCache | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now + 60_000) {
    return cache.accessToken;
  }

  const { clientId, clientSecret } = requireWclCredentials();
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const response = await fetch("https://www.warcraftlogs.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WCL OAuth failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  cache = {
    accessToken: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };

  return cache.accessToken;
}

export function clearTokenCache(): void {
  cache = null;
}
