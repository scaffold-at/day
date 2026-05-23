import { describe, expect, it } from "bun:test";
import { loadBrokerConfig } from "./config";

const completeEnv = {
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  GOOGLE_REDIRECT_URI: "https://auth.scaffold.at/api/auth/google/callback",
  DATABASE_URL: "postgres://user:pass@example.invalid/scaffold_day",
  TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  BROKER_PUBLIC_BASE_URL: "https://auth.scaffold.at/",
  BROKER_SESSION_SIGNING_KEY: "broker-session-signing-key",
};

describe("broker config", () => {
  it("loads and normalizes required broker env vars", () => {
    const config = loadBrokerConfig(completeEnv);

    expect(config.googleClientId).toBe("google-client-id");
    expect(config.googleClientSecret).toBe("google-client-secret");
    expect(config.googleRedirectUri).toBe("https://auth.scaffold.at/api/auth/google/callback");
    expect(config.databaseUrl).toBe("postgres://user:pass@example.invalid/scaffold_day");
    expect(config.tokenEncryptionKey).toBe("0123456789abcdef0123456789abcdef");
    expect(config.brokerPublicBaseUrl).toBe("https://auth.scaffold.at");
    expect(config.brokerSessionSigningKey).toBe("broker-session-signing-key");
  });

  it("derives the Google redirect URI from BROKER_PUBLIC_BASE_URL when omitted", () => {
    const { GOOGLE_REDIRECT_URI, ...env } = completeEnv;

    expect(loadBrokerConfig(env).googleRedirectUri).toBe(
      "https://auth.scaffold.at/api/auth/google/callback",
    );
  });

  it("derives broker URLs from VERCEL_URL when BROKER_PUBLIC_BASE_URL is omitted", () => {
    const { BROKER_PUBLIC_BASE_URL, GOOGLE_REDIRECT_URI, ...env } = completeEnv;

    const config = loadBrokerConfig({
      ...env,
      VERCEL_URL: "scaffold-day-auth-broker-preview.vercel.app",
    });

    expect(config.brokerPublicBaseUrl).toBe("https://scaffold-day-auth-broker-preview.vercel.app");
    expect(config.googleRedirectUri).toBe(
      "https://scaffold-day-auth-broker-preview.vercel.app/api/auth/google/callback",
    );
  });

  it("fails clearly when a required env var is missing", () => {
    const { TOKEN_ENCRYPTION_KEY, ...env } = completeEnv;

    expect(() => loadBrokerConfig(env)).toThrow(
      "Missing required environment variable: TOKEN_ENCRYPTION_KEY",
    );
  });

  it("fails clearly when URL env vars are malformed", () => {
    expect(() => loadBrokerConfig({ ...completeEnv, BROKER_PUBLIC_BASE_URL: "not a url" })).toThrow(
      "BROKER_PUBLIC_BASE_URL must be a valid URL",
    );
    expect(() => loadBrokerConfig({ ...completeEnv, GOOGLE_REDIRECT_URI: "not a url" })).toThrow(
      "GOOGLE_REDIRECT_URI must be a valid URL",
    );
  });
});
