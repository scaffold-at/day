import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ScaffoldError } from "../error";
import { atomicWrite } from "./atomic-write";

export type LockFileBody = {
  pid: number;
  started_at: string;
  last_heartbeat_at: string;
  scaffold_day_version?: string;
};

export type AdvisoryLockOptions = {
  /** Heartbeat refresh interval, ms. Default 30 000. */
  heartbeatMs?: number;
  /** Stale-takeover threshold, ms. Default 120 000. */
  staleMs?: number;
  /** Recorded inside the lock file payload — purely informational. */
  scaffoldDayVersion?: string;
};

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_STALE_MS = 120_000;

/**
 * Advisory single-writer lock backed by a single JSON file
 * (typically `<home>/.scaffold-day/lock`). Acquisition logic:
 *
 *   1. `open(path, "wx")` — exclusive create. If success → we own.
 *   2. On EEXIST, read the existing lock file.
 *      - If `last_heartbeat_at` is older than `staleMs`, take over
 *        with an atomicWrite (the previous owner is presumed dead).
 *      - Otherwise throw `DAY_LOCK_HELD`.
 *   3. While held, refresh `last_heartbeat_at` every `heartbeatMs`.
 *
 * The heartbeat timer is `unref()`-ed so the process can still exit
 * naturally; the lock will simply go stale and be reclaimed by the
 * next acquirer (after `staleMs`).
 */
export class AdvisoryLock {
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private readonly version: string | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private acquired = false;

  constructor(
    public readonly path: string,
    options: AdvisoryLockOptions = {},
  ) {
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    this.version = options.scaffoldDayVersion;
  }

  isAcquired(): boolean {
    return this.acquired;
  }

  async acquire(): Promise<void> {
    if (this.acquired) return;

    try {
      await this.writeExclusive();
    } catch (err) {
      if (!isEexist(err)) throw err;
      const existing = await this.readExisting();
      // A null `existing` means the file is unreadable or malformed —
      // treat it as stale and take over rather than block forever on a
      // corrupted lock from a crashed prior run.
      if (!existing || this.isStale(existing)) {
        await atomicWrite(this.path, this.serialize(), { mode: 0o600 });
      } else {
        throw this.heldError(existing);
      }
    }

    this.acquired = true;
    this.startHeartbeat();
  }

  async release(): Promise<void> {
    if (!this.acquired) return;
    this.stopHeartbeat();
    try {
      // Only remove the file if we still own it — this avoids deleting
      // a file a takeover process now holds.
      const existing = await this.readExisting();
      if (existing && existing.pid === process.pid) {
        await unlink(this.path);
      }
    } catch {
      // best-effort
    }
    this.acquired = false;
  }

  // ─── internals ────────────────────────────────────────────────────

  private async writeExclusive(): Promise<void> {
    // mkdir -p the parent so callers don't have to.
    await import("node:fs/promises").then((mod) =>
      mod.mkdir(path.dirname(this.path), { recursive: true }),
    );
    const fh = await open(this.path, "wx", 0o600);
    try {
      await fh.writeFile(this.serialize());
      await fh.sync();
    } finally {
      await fh.close();
    }
  }

  private async readExisting(): Promise<LockFileBody | null> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<LockFileBody>;
      if (
        typeof parsed.pid !== "number" ||
        typeof parsed.started_at !== "string" ||
        typeof parsed.last_heartbeat_at !== "string"
      ) {
        return null;
      }
      return {
        pid: parsed.pid,
        started_at: parsed.started_at,
        last_heartbeat_at: parsed.last_heartbeat_at,
        scaffold_day_version: parsed.scaffold_day_version,
      };
    } catch {
      return null;
    }
  }

  private isStale(lock: LockFileBody): boolean {
    const lastBeat = Date.parse(lock.last_heartbeat_at);
    if (!Number.isFinite(lastBeat)) return true;
    return Date.now() - lastBeat > this.staleMs;
  }

  private serialize(): string {
    const now = new Date().toISOString();
    const body: LockFileBody = {
      pid: process.pid,
      started_at: now,
      last_heartbeat_at: now,
      ...(this.version ? { scaffold_day_version: this.version } : {}),
    };
    return `${JSON.stringify(body, null, 2)}\n`;
  }

  private heldError(existing: LockFileBody | null): ScaffoldError {
    const ctx: Record<string, unknown> = { path: this.path };
    let summaryEn = "another scaffold-day process holds the lock";
    let summaryKo = "다른 scaffold-day 프로세스가 잠금을 점유 중입니다";
    if (existing) {
      ctx.holder_pid = existing.pid;
      ctx.started_at = existing.started_at;
      ctx.last_heartbeat_at = existing.last_heartbeat_at;
      summaryEn = `lock held by pid ${existing.pid} since ${existing.started_at}`;
      summaryKo = `pid ${existing.pid} 가 ${existing.started_at} 부터 잠금을 점유 중`;
    }
    return new ScaffoldError({
      code: "DAY_LOCK_HELD",
      summary: { en: summaryEn, ko: summaryKo },
      cause: `Only one scaffold-day process can mutate ~/scaffold-day/ at a time.\nLock file: ${this.path}`,
      try: [
        "Wait for the other process to finish, then retry.",
        `If the holder died, the lock will be reclaimed automatically after ${Math.round(
          this.staleMs / 1000,
        )} s of no heartbeat.`,
      ],
      context: ctx,
    });
  }

  private startHeartbeat(): void {
    this.timer = setInterval(() => {
      this.updateHeartbeat().catch(() => {
        // Heartbeat is best-effort; failures are surfaced on next
        // acquire attempt by another process.
      });
    }, this.heartbeatMs);
    this.timer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async updateHeartbeat(): Promise<void> {
    const existing = await this.readExisting();
    if (!existing || existing.pid !== process.pid) {
      // Lost ownership — stop beating.
      this.stopHeartbeat();
      this.acquired = false;
      return;
    }
    const next: LockFileBody = {
      ...existing,
      last_heartbeat_at: new Date().toISOString(),
    };
    await atomicWrite(this.path, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
    });
  }
}

function isEexist(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "EEXIST"
  );
}
