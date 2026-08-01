import { describe, expect, it } from "bun:test";
import { buildGoogleAuthorizationUrl, exchangeGoogleCode } from "./google-oauth";

describe("Google OAuth broker", () => {
  it("builds a Google authorization URL with Calendar and Tasks scopes", () => {
    const url = buildGoogleAuthorizationUrl({
      clientId: "client-id.example.apps.googleusercontent.com",
      redirectUri: "https://auth.scaffold.at/api/auth/google/callback\n",
      state: "state-123",
    });

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id.example.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://auth.scaffold.at/api/auth/google/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/tasks",
    ]);
  });

  it("exchanges an authorization code for Google tokens", async () => {
    const calls: { url: string; body: string }[] = [];
    const tokens = await exchangeGoogleCode(
      {
        code: "code-123",
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "https://auth.scaffold.at/api/auth/google/callback",
      },
      async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body) });
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3599,
            scope:
              "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks",
            token_type: "Bearer",
            id_token: "id-token",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    expect(tokens.refreshToken).toBe("refresh-token");
    expect(tokens.accessToken).toBe("access-token");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(calls[0]?.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-123");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe("client-secret");
  });
});
