// OS-native secret storage backend (S73).
//
// Wraps `security` (macOS Keychain) and `secret-tool` (Linux
// libsecret) via subprocess so we don't depend on a node-gyp native
// module — `bun --compile` produces single-file binaries that don't
// support keytar's prebuilt .node addons.
//
// Tier 1: macOS arm64, Linux x64. Other OSes (and absent CLI tools)
// transparently fall back to file storage at the call site; this
// module never throws on availability checks.

import { spawn } from "node:child_process";

const SERVICE = "scaffold-day-google-oauth";

export type KeychainBackend = "macos" | "linux" | "none";

type ProcResult = { code: number; stdout: string; stderr: string };

async function runProc(
  cmd: string,
  args: string[],
  input?: string,
): Promise<ProcResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolve({ code: 127, stdout: "", stderr: "spawn failed" });
      return;
    }
    child.stdout.on("data", (b) => {
      stdout += String(b);
    });
    child.stderr.on("data", (b) => {
      stderr += String(b);
    });
    child.on("error", () => resolve({ code: 127, stdout, stderr }));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

let cached: KeychainBackend | null = null;

/**
 * Detect which keychain CLI is reachable on the host. Cached after
 * first call. Pass `force=true` to re-probe (used by tests).
 */
export async function detectKeychainBackend(force = false): Promise<KeychainBackend> {
  if (!force && cached !== null) return cached;
  if (process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN === "1") {
    cached = "none";
    return cached;
  }
  if (process.platform === "darwin") {
    const r = await runProc("security", ["-h"]);
    cached = r.code === 0 ? "macos" : "none";
    return cached;
  }
  if (process.platform === "linux") {
    const r = await runProc("secret-tool", ["--help"]);
    cached = r.code === 0 ? "linux" : "none";
    return cached;
  }
  cached = "none";
  return cached;
}

/** Test-only: clear the cache so the next detect() re-probes. */
export function _resetKeychainCache(): void {
  cached = null;
}

export async function keychainStore(
  account: string,
  secret: string,
): Promise<void> {
  const backend = await detectKeychainBackend();
  if (backend === "macos") {
    // -U overwrites if a matching item already exists.
    const r = await runProc("security", [
      "add-generic-password",
      "-a", account,
      "-s", SERVICE,
      "-w", secret,
      "-U",
    ]);
    if (r.code !== 0) throw new Error(`keychain store failed: ${r.stderr.trim()}`);
    return;
  }
  if (backend === "linux") {
    // Read secret from stdin so it never appears in argv / ps output.
    const r = await runProc(
      "secret-tool",
      ["store", "--label", "scaffold-day Google OAuth", "service", SERVICE, "account", account],
      secret,
    );
    if (r.code !== 0) throw new Error(`keychain store failed: ${r.stderr.trim()}`);
    return;
  }
  throw new Error("keychain backend unavailable");
}

export async function keychainRetrieve(account: string): Promise<string | null> {
  const backend = await detectKeychainBackend();
  if (backend === "macos") {
    const r = await runProc("security", [
      "find-generic-password",
      "-a", account,
      "-s", SERVICE,
      "-w",
    ]);
    if (r.code !== 0) return null;
    return r.stdout.replace(/\n$/, "");
  }
  if (backend === "linux") {
    const r = await runProc(
      "secret-tool",
      ["lookup", "service", SERVICE, "account", account],
    );
    if (r.code !== 0) return null;
    return r.stdout;
  }
  return null;
}

export async function keychainDelete(account: string): Promise<boolean> {
  const backend = await detectKeychainBackend();
  if (backend === "macos") {
    const r = await runProc("security", [
      "delete-generic-password",
      "-a", account,
      "-s", SERVICE,
    ]);
    return r.code === 0;
  }
  if (backend === "linux") {
    const r = await runProc(
      "secret-tool",
      ["clear", "service", SERVICE, "account", account],
    );
    return r.code === 0;
  }
  return false;
}

/** Sentinel stored in the file when the real refresh_token lives in the keychain. */
export const KEYCHAIN_REFRESH_SENTINEL_PREFIX = "keychain://google-oauth/";

export function makeKeychainSentinel(account: string): string {
  return `${KEYCHAIN_REFRESH_SENTINEL_PREFIX}${account}`;
}

export function parseKeychainSentinel(value: string): string | null {
  if (!value.startsWith(KEYCHAIN_REFRESH_SENTINEL_PREFIX)) return null;
  return value.slice(KEYCHAIN_REFRESH_SENTINEL_PREFIX.length);
}
