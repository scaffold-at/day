const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
] as const;

export type GoogleAuthorizationUrlInput = {
  clientId: string;
  redirectUri: string;
  state: string;
};

export type GoogleCodeExchangeInput = {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope: string;
  tokenType: string;
  idToken?: string;
};

type GoogleTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  id_token?: unknown;
  error?: unknown;
  error_description?: unknown;
};

type FetchLike = (
  url: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>;

export function buildGoogleAuthorizationUrl(input: GoogleAuthorizationUrlInput): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId.trim());
  url.searchParams.set("redirect_uri", input.redirectUri.trim());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  return url;
}

export async function exchangeGoogleCode(
  input: GoogleCodeExchangeInput,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code: input.code.trim(),
    client_id: input.clientId.trim(),
    client_secret: input.clientSecret.trim(),
    redirect_uri: input.redirectUri.trim(),
    grant_type: "authorization_code",
  });

  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok) {
    const message =
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : `Google token exchange failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  if (typeof payload.access_token !== "string") {
    throw new Error("Google token response did not include access_token");
  }
  if (typeof payload.expires_in !== "number") {
    throw new Error("Google token response did not include numeric expires_in");
  }
  if (typeof payload.token_type !== "string") {
    throw new Error("Google token response did not include token_type");
  }
  if (typeof payload.scope !== "string") {
    throw new Error("Google token response did not include scope");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expiresIn: payload.expires_in,
    scope: payload.scope,
    tokenType: payload.token_type,
    idToken: typeof payload.id_token === "string" ? payload.id_token : undefined,
  };
}

export function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
