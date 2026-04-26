import { type FileHandle, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

const TMP_RAND = "abcdefghijklmnopqrstuvwxyz0123456789";

function tmpSuffix(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += TMP_RAND[Math.floor(Math.random() * TMP_RAND.length)];
  return out;
}

export type AtomicWriteOptions = {
  /** File mode for the tmp file (and final target if newly created). Default 0o600. */
  mode?: number;
  /** Best-effort directory fsync after rename. Default true; falls back to noop on EISDIR/ENOTSUP. */
  fsyncDir?: boolean;
};

/**
 * Atomically replace `target` with `content`.
 *
 * Algorithm (POSIX): write to a tmp file in the same directory, fsync
 * the data, close it, then `rename(tmp, target)`. The rename is atomic
 * on POSIX filesystems, so any concurrent reader sees either the old
 * file or the new file, never a partial write.
 *
 * On any error before the rename succeeds, the tmp file is removed and
 * `target` stays untouched.
 *
 * Windows is Tier 3 (PRD §6.1) — it has different rename semantics
 * when the target exists; v0.1 does not guarantee atomicity there.
 */
export async function atomicWrite(
  target: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const mode = options.mode ?? 0o600;
  const dir = path.dirname(target);
  const base = path.basename(target);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.${tmpSuffix()}.tmp`);

  await mkdir(dir, { recursive: true });

  let fh: FileHandle | null = null;
  try {
    fh = await open(tmp, "wx", mode);
    await fh.writeFile(content);
    await fh.sync();
    await fh.close();
    fh = null;

    await rename(tmp, target);

    if (options.fsyncDir !== false) {
      let dirFh: FileHandle | null = null;
      try {
        dirFh = await open(dir, "r");
        await dirFh.sync();
      } catch {
        // EISDIR / ENOTSUP / EACCES — directory fsync is a best-effort
        // durability optimization, not a correctness gate. Ignore.
      } finally {
        if (dirFh) {
          try {
            await dirFh.close();
          } catch {
            // ignore — already best-effort
          }
        }
      }
    }
  } catch (err) {
    if (fh) {
      try {
        await fh.close();
      } catch {
        // ignore
      }
    }
    try {
      await unlink(tmp);
    } catch {
      // tmp may not exist (e.g., open() failed) — ignore
    }
    throw err;
  }
}
