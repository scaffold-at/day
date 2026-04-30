import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _resetKeychainCache,
  detectKeychainBackend,
  KEYCHAIN_REFRESH_SENTINEL_PREFIX,
  makeKeychainSentinel,
  parseKeychainSentinel,
} from "./keychain";

describe("keychain sentinel helpers", () => {
  test("round-trip: makeKeychainSentinel ↔ parseKeychainSentinel", () => {
    const account = "u@example.com";
    const s = makeKeychainSentinel(account);
    expect(s).toBe(`${KEYCHAIN_REFRESH_SENTINEL_PREFIX}${account}`);
    expect(parseKeychainSentinel(s)).toBe(account);
  });

  test("non-sentinel strings parse to null", () => {
    expect(parseKeychainSentinel("ya29.real-access-token")).toBeNull();
    expect(parseKeychainSentinel("1//refresh-string")).toBeNull();
    expect(parseKeychainSentinel("")).toBeNull();
  });

  test("sentinel preserves emails containing '@' and '.'", () => {
    const account = "first.last+work@sub.domain.example";
    expect(parseKeychainSentinel(makeKeychainSentinel(account))).toBe(account);
  });
});

describe("detectKeychainBackend — disable env", () => {
  let prior: string | undefined;
  beforeEach(() => {
    prior = process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN;
    _resetKeychainCache();
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN;
    else process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN = prior;
    _resetKeychainCache();
  });

  test("SCAFFOLD_DAY_DISABLE_KEYCHAIN=1 forces 'none' regardless of platform", async () => {
    process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN = "1";
    const b = await detectKeychainBackend(true);
    expect(b).toBe("none");
  });

  test("without the env var, returns one of macos/linux/none for the current host", async () => {
    delete process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN;
    const b = await detectKeychainBackend(true);
    expect(["macos", "linux", "none"]).toContain(b);
  });
});
