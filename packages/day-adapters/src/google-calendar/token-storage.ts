import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWrite, ScaffoldError } from "@scaffold/day-core";
import {
  detectKeychainBackend,
  keychainDelete,
  keychainRetrieve,
  keychainStore,
  makeKeychainSentinel,
  parseKeychainSentinel,
} from "./keychain";

export const SECRETS_DIR = ".secrets";
export const GOOGLE_OAUTH_FILE = "google-oauth.json";

export const GoogleOAuthTokenSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    token_type: z.string().default("Bearer"),
    expiry_at: z.string().nullable(),
    scope: z.string().min(1),
    /** Account email when known — surfaced by `auth list`. */
    account_email: z.string().email().nullable().default(null),
    /** Where the refresh_token lives. "keychain" means the file's
     * refresh_token field is a sentinel pointing at the OS keychain. */
    storage: z.enum(["keychain", "file"]).default("file"),
  })
  .strict();

export type GoogleOAuthToken = z.infer<typeof GoogleOAuthTokenSchema>;

export function tokenFilePath(home: string): string {
  return path.join(home, SECRETS_DIR, GOOGLE_OAUTH_FILE);
}

/**
 * Read the token file. Returns null if missing. Throws
 * DAY_INVALID_INPUT on a malformed file.
 *
 * When `storage === "keychain"` the file's `refresh_token` is a
 * sentinel; this function transparently fetches the real value from
 * the OS keychain and substitutes it. If the keychain entry is gone
 * the returned token's `refresh_token` is the empty sentinel — the
 * caller should treat that the same as a missing token.
 */
export async function readGoogleOAuthToken(
  home: string,
): Promise<GoogleOAuthToken | null> {
  const target = tokenFilePath(home);
  let raw: string;
  try {
    raw = await readFile(target, "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
  const parsed = GoogleOAuthTokenSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "google-oauth.json failed schema validation" },
      cause: parsed.error.message,
      try: ["Restore from a backup or re-run `scaffold-day auth login`."],
      context: { file: target },
    });
  }
  const token = parsed.data;
  const sentinelAccount = parseKeychainSentinel(token.refresh_token);
  if (sentinelAccount !== null) {
    const real = await keychainRetrieve(sentinelAccount);
    if (real && real.length > 0) {
      token.refresh_token = real;
    } else {
      // Keep the sentinel — adapter will detect the missing refresh
      // token at refresh time and surface DAY_OAUTH_NO_REFRESH.
    }
  }
  return token;
}

export type WriteOptions = {
  /** Force file storage even when a keychain backend is reachable. */
  preferFile?: boolean;
};

/**
 * Write the token. Atomic file write at mode 0600. When a keychain
 * backend is reachable and `preferFile` is not set, the refresh_token
 * is stored in the OS keychain and the file gets a sentinel pointer.
 * Returns the persisted token (with `storage` reflecting the chosen
 * backend).
 */
export async function writeGoogleOAuthToken(
  home: string,
  token: GoogleOAuthToken,
  opts: WriteOptions = {},
): Promise<GoogleOAuthToken> {
  const validated = GoogleOAuthTokenSchema.parse(token);
  const account = validated.account_email;

  let toWrite: GoogleOAuthToken = validated;
  if (!opts.preferFile && account) {
    const backend = await detectKeychainBackend();
    if (backend !== "none") {
      try {
        await keychainStore(account, validated.refresh_token);
        toWrite = {
          ...validated,
          refresh_token: makeKeychainSentinel(account),
          storage: "keychain",
        };
      } catch {
        // Keychain write failed — fall through to file storage.
        toWrite = { ...validated, storage: "file" };
      }
    } else {
      toWrite = { ...validated, storage: "file" };
    }
  } else {
    toWrite = { ...validated, storage: "file" };
  }

  const target = tokenFilePath(home);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await atomicWrite(target, `${JSON.stringify(toWrite, null, 2)}\n`, {
    mode: 0o600,
  });
  return toWrite;
}

export async function deleteGoogleOAuthToken(home: string): Promise<boolean> {
  const target = tokenFilePath(home);
  // Best-effort: read first to learn the keychain account before
  // unlinking the file. Errors here mean the file is already gone or
  // malformed — proceed to unlink anyway.
  let keychainAccount: string | null = null;
  try {
    const raw = await readFile(target, "utf8");
    const parsed = GoogleOAuthTokenSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      const sentinel = parseKeychainSentinel(parsed.data.refresh_token);
      if (sentinel !== null) keychainAccount = sentinel;
    }
  } catch {
    /* ignore */
  }

  const { unlink } = await import("node:fs/promises");
  let removed = false;
  try {
    await unlink(target);
    removed = true;
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") throw err;
  }
  if (keychainAccount) {
    await keychainDelete(keychainAccount);
  }
  return removed;
}
