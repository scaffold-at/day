import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWrite, ScaffoldError } from "@scaffold/day-core";

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
    /** Where the token came from (keytar | file). v0.1 records "file"
     * since keytar fallback is strict file-mode. */
    storage: z.enum(["keytar", "file"]).default("file"),
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
 * v0.1 always uses the file fallback (per PRD §12.1) — keytar
 * support lands in §S28 once the bun --compile compatibility test
 * (§R1) passes on every release platform.
 */
export async function readGoogleOAuthToken(
  home: string,
): Promise<GoogleOAuthToken | null> {
  const target = tokenFilePath(home);
  try {
    const raw = await readFile(target, "utf8");
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
    return parsed.data;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Write the token file with mode 0600. Atomic write ensures concurrent
 * readers always see either the old or the new file, never a torn one.
 */
export async function writeGoogleOAuthToken(
  home: string,
  token: GoogleOAuthToken,
): Promise<void> {
  const target = tokenFilePath(home);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const validated = GoogleOAuthTokenSchema.parse(token);
  await atomicWrite(target, `${JSON.stringify(validated, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function deleteGoogleOAuthToken(home: string): Promise<boolean> {
  const target = tokenFilePath(home);
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(target);
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return false;
    throw err;
  }
}
