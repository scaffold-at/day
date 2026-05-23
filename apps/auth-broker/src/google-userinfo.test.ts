import { describe, expect, it } from "bun:test";
import { fetchGoogleUserInfo } from "./google-userinfo";

describe("Google userinfo", () => {
  it("fetches the Google subject and email for an access token", async () => {
    const calls: { url: string; authorization: string | null }[] = [];
    const user = await fetchGoogleUserInfo("access-token", async (url, init) => {
      calls.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ sub: "google-user-1", email: "user@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    expect(user).toEqual({ sub: "google-user-1", email: "user@example.com" });
    expect(calls).toEqual([
      {
        url: "https://www.googleapis.com/oauth2/v3/userinfo",
        authorization: "Bearer access-token",
      },
    ]);
  });
});
