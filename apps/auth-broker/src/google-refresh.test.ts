import { describe, expect, it } from "bun:test";
import { exchangeRefreshToken } from "./google-refresh";

describe("Google refresh token exchange", () => {
  it("exchanges a refresh token for a short-lived access token", async () => {
    const calls: { url: string; body: string }[] = [];
    const token = await exchangeRefreshToken(
      {
        refreshToken: "refresh-token",
        clientId: "client-id",
        clientSecret: "client-secret",
      },
      async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body) });
        return new Response(
          JSON.stringify({
            access_token: "new-access-token",
            expires_in: 3599,
            scope: "openid email",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    expect(token.accessToken).toBe("new-access-token");
    const body = new URLSearchParams(calls[0]?.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-token");
  });
});
