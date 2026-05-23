const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

type FetchLike = (
  url: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>;

type GoogleUserInfoResponse = {
  sub?: unknown;
  email?: unknown;
  error?: unknown;
  error_description?: unknown;
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
};

export async function fetchGoogleUserInfo(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleUserInfo> {
  const response = await fetchImpl(GOOGLE_USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken.trim()}` },
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleUserInfoResponse;
  if (!response.ok) {
    const message =
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : `Google userinfo failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  if (typeof payload.sub !== "string") {
    throw new Error("Google userinfo response did not include sub");
  }
  if (typeof payload.email !== "string") {
    throw new Error("Google userinfo response did not include email");
  }
  return { sub: payload.sub, email: payload.email };
}
