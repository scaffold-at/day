const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type FetchLike = typeof fetch;

export type GoogleRefreshInput = {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
};

export type GoogleAccessToken = {
  accessToken: string;
  expiresIn: number;
  scope?: string;
  tokenType: string;
};

type GoogleRefreshResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
};

export async function exchangeRefreshToken(
  input: GoogleRefreshInput,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleAccessToken> {
  const body = new URLSearchParams({
    client_id: input.clientId.trim(),
    client_secret: input.clientSecret.trim(),
    refresh_token: input.refreshToken.trim(),
    grant_type: "refresh_token",
  });

  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleRefreshResponse;
  if (!response.ok) {
    const message =
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : `Google refresh token exchange failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  if (typeof payload.access_token !== "string") {
    throw new Error("Google refresh response did not include access_token");
  }
  if (typeof payload.expires_in !== "number") {
    throw new Error("Google refresh response did not include numeric expires_in");
  }
  if (typeof payload.token_type !== "string") {
    throw new Error("Google refresh response did not include token_type");
  }
  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
    tokenType: payload.token_type,
  };
}
