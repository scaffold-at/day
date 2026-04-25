import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { metaDir } from "./storage";

export const BACKUPS_DIR = ".backups";
export const LOCK_FILE = "lock";

export function backupsRoot(home: string): string {
  return path.join(metaDir(home), BACKUPS_DIR);
}

type SkipPredicate = (absolutePath: string) => boolean;

async function copyTree(src: string, dest: string, skip: SkipPredicate): Promise<void> {
  if (skip(src)) return;
  const stats = await stat(src);
  if (stats.isDirectory()) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src);
    for (const name of entries) {
      await copyTree(path.join(src, name), path.join(dest, name), skip);
    }
    return;
  }
  if (stats.isFile()) {
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
  // Symlinks / sockets / pipes are intentionally ignored — scaffold-day
  // never writes them under ~/scaffold-day/.
}

/**
 * Snapshot the entire scaffold-day home into
 * `<home>/.scaffold-day/.backups/<ISO-timestamp>/` before a destructive
 * operation (currently: migrations).
 *
 * The advisory lock and the backups directory itself are excluded so we
 * never recurse into the snapshot we are creating. We do the recursion
 * by hand instead of `fs.cp` because Node refuses any cp() whose dest
 * is a subdirectory of src (even with a filter that would prevent the
 * recursion).
 */
export async function createMigrationBackup(home: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = backupsRoot(home);
  const dest = path.join(root, stamp);
  await mkdir(dest, { recursive: true });

  const lockPath = path.join(metaDir(home), LOCK_FILE);
  const skip: SkipPredicate = (p) => {
    if (p === root) return true;
    if (p.startsWith(`${root}${path.sep}`)) return true;
    if (p === lockPath) return true;
    return false;
  };

  // Walk the children of `home` directly so we never visit `home` itself,
  // which keeps the destination (a descendant of home) out of the walk.
  const entries = await readdir(home);
  for (const name of entries) {
    await copyTree(path.join(home, name), path.join(dest, name), skip);
  }

  return dest;
}
