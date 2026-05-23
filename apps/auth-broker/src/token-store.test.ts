import { describe, expect, it } from "bun:test";
import {
  decryptSecret,
  encryptSecret,
  initAuthBrokerSchema,
  storeGoogleTokenSet,
  upsertBrokerSession,
} from "./token-store";

describe("token encryption", () => {
  it("encrypts refresh tokens with AES-GCM and decrypts them with the same key", async () => {
    const encrypted = await encryptSecret("refresh-token", "0123456789abcdef0123456789abcdef");

    expect(encrypted).not.toContain("refresh-token");
    expect(encrypted).toStartWith("v1:");
    await expect(decryptSecret(encrypted, "0123456789abcdef0123456789abcdef")).resolves.toBe("refresh-token");
  });
});

describe("auth broker persistence SQL", () => {
  it("creates the OAuth token and broker session tables", async () => {
    const calls: string[] = [];
    await initAuthBrokerSchema(async (strings) => {
      calls.push(strings.join("?"));
      return [];
    });

    expect(calls.join("\n")).toContain("CREATE TABLE IF NOT EXISTS google_oauth_tokens");
    expect(calls.join("\n")).toContain("CREATE TABLE IF NOT EXISTS broker_sessions");
  });

  it("stores encrypted Google token sets without exposing the refresh token", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    await storeGoogleTokenSet(
      async (strings, ...values) => {
        calls.push({ sql: strings.join("?"), values });
        return [];
      },
      {
        googleSubject: "google-user-1",
        email: "user@example.com",
        refreshToken: "refresh-token",
        accessToken: "access-token",
        scope: "openid email",
        expiresIn: 3600,
      },
      "0123456789abcdef0123456789abcdef",
    );

    const callText = JSON.stringify(calls);
    expect(callText).not.toContain("refresh-token");
    expect(callText).toContain("google_oauth_tokens");
    expect(calls[0]?.values.some((value) => typeof value === "string" && value.startsWith("v1:"))).toBe(true);
  });

  it("upserts a hashed broker session token", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const session = await upsertBrokerSession(
      async (strings, ...values) => {
        calls.push({ sql: strings.join("?"), values });
        return [];
      },
      {
        googleSubject: "google-user-1",
        email: "user@example.com",
      },
      "signing-key",
    );

    expect(session.token.length).toBeGreaterThan(32);
    expect(session.expiresAt).toBeInstanceOf(Date);
    expect(JSON.stringify(calls)).not.toContain(session.token);
    expect(calls[0]?.sql).toContain("broker_sessions");
  });
});
