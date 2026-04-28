/**
 * Pseudonymous machine identifier (PRD v0.2 §S65 / §S66).
 *
 * Used by `telemetry` to deduplicate events from the same machine
 * and by `feedback` for rate-limit checks. *Pseudonymous*, not
 * anonymous: messages don't carry content, but repeated submissions
 * from the same install_id are linkable.
 *
 * Storage: a single UUID v4 line at `<home>/.install-id`. Mode
 * 0644 — it's not a secret, just a stable handle. Created lazily on
 * first read.
 *
 * Reset: deleting the file (or calling `resetInstallId()`) issues a
 * fresh UUID on the next read. The doctor command surfaces the
 * current id so a user can quote it when filing a bug.
 */

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../schema/storage";

export const INSTALL_ID_FILE = ".install-id";

export function installIdPath(home: string): string {
  return path.join(home, INSTALL_ID_FILE);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function newUuid(): string {
  return crypto.randomUUID();
}

/**
 * Read the install_id, creating one if absent. Returns the UUID
 * string. Tolerates a malformed file by overwriting it.
 */
export async function readOrCreateInstallId(home: string): Promise<string> {
  const p = installIdPath(home);
  if (await pathExists(p)) {
    try {
      const raw = (await readFile(p, "utf8")).trim();
      if (UUID_RE.test(raw)) return raw;
    } catch {
      // fall through to recreate
    }
  }
  const id = newUuid();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, `${id}\n`, { mode: 0o644 });
  return id;
}

/** Read existing id without creating one; null when absent / malformed. */
export async function readInstallId(home: string): Promise<string | null> {
  const p = installIdPath(home);
  if (!(await pathExists(p))) return null;
  try {
    const raw = (await readFile(p, "utf8")).trim();
    return UUID_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Replace the install_id with a fresh UUID. Returns the new id. */
export async function resetInstallId(home: string): Promise<string> {
  const p = installIdPath(home);
  if (await pathExists(p)) {
    await unlink(p);
  }
  return readOrCreateInstallId(home);
}
