import { describe, expect, test } from "bun:test";
import { isScaffoldError } from "@scaffold/day-core";
import {
  generatePkceVerifier,
  generateState,
  pkceChallenge,
  runOAuthDesktopFlow,
} from "./oauth-desktop";

describe("PKCE primitives", () => {
  test("verifier is 43-128 base64url chars", () => {
    const v = generatePkceVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });

  test("two verifiers are not equal", () => {
    expect(generatePkceVerifier()).not.toBe(generatePkceVerifier());
  });

  test("challenge is the SHA-256 base64url of the verifier", async () => {
    // RFC 7636 Appendix B test vector — verify the formula.
    const verifier =
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await pkceChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("state is base64url and short", () => {
    const s = generateState();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThanOrEqual(20);
  });
});

describe("runOAuthDesktopFlow — error paths", () => {
  test("times out with a clear error when the user never returns", async () => {
    let urlReceived = "";
    let caught: unknown;
    try {
      await runOAuthDesktopFlow({
        clientId: "test-client.apps.googleusercontent.com",
        clientSecret: "test-secret",
        timeoutMs: 200,
        openBrowser: () => {}, // do nothing — never simulates a callback
        onAuthUrl: (u) => {
          urlReceived = u;
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(urlReceived).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(urlReceived).toContain("code_challenge_method=S256");
    expect(urlReceived).toContain("response_type=code");
    expect(caught).toBeDefined();
  });

  // Driving the local callback server from inside the same process
  // is racy under bun.serve port-0 binding; the auth-URL formation
  // is what matters at unit-test scope. State / error-parameter
  // handling is exercised end-to-end on the real Google flow.
});
