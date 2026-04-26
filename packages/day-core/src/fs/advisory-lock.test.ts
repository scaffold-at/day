import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isScaffoldError } from "../error";
import { AdvisoryLock, type LockFileBody } from "./advisory-lock";

let dir: string;
let lockPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "scaffold-day-lock-"));
  lockPath = path.join(dir, "lock");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("AdvisoryLock — happy path", () => {
  test("acquire creates the file with our pid; release deletes it", async () => {
    const lock = new AdvisoryLock(lockPath, { heartbeatMs: 60_000, staleMs: 60_000 });
    await lock.acquire();
    expect(lock.isAcquired()).toBe(true);

    const body = JSON.parse(await readFile(lockPath, "utf8")) as LockFileBody;
    expect(body.pid).toBe(process.pid);
    expect(typeof body.started_at).toBe("string");
    expect(typeof body.last_heartbeat_at).toBe("string");

    await lock.release();
    expect(lock.isAcquired()).toBe(false);

    let exists = false;
    try {
      await stat(lockPath);
      exists = true;
    } catch {}
    expect(exists).toBe(false);
  });

  test("double acquire is idempotent", async () => {
    const lock = new AdvisoryLock(lockPath, { heartbeatMs: 60_000 });
    await lock.acquire();
    await lock.acquire();
    expect(lock.isAcquired()).toBe(true);
    await lock.release();
  });

  test("creates parent directory if missing", async () => {
    const nested = path.join(dir, "deep", "nest", "lock");
    const lock = new AdvisoryLock(nested);
    await lock.acquire();
    expect(lock.isAcquired()).toBe(true);
    await lock.release();
  });
});

describe("AdvisoryLock — contention", () => {
  test("second acquirer throws DAY_LOCK_HELD with holder context", async () => {
    const a = new AdvisoryLock(lockPath, { heartbeatMs: 60_000, staleMs: 60_000 });
    const b = new AdvisoryLock(lockPath, { heartbeatMs: 60_000, staleMs: 60_000 });

    await a.acquire();
    let caught: unknown;
    try {
      await b.acquire();
    } catch (err) {
      caught = err;
    }

    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) {
      expect(caught.code).toBe("DAY_LOCK_HELD");
      expect(caught.context.holder_pid).toBe(process.pid);
      expect(typeof caught.context.last_heartbeat_at).toBe("string");
    }

    await a.release();
  });

  test("after release, a new acquirer succeeds", async () => {
    const a = new AdvisoryLock(lockPath, { heartbeatMs: 60_000 });
    await a.acquire();
    await a.release();

    const b = new AdvisoryLock(lockPath, { heartbeatMs: 60_000 });
    await b.acquire();
    expect(b.isAcquired()).toBe(true);
    await b.release();
  });
});

describe("AdvisoryLock — stale takeover", () => {
  test("takes over a lock whose last_heartbeat_at is older than staleMs", async () => {
    // Write a stale lock file with a foreign pid.
    const stale: LockFileBody = {
      pid: 999_999,
      started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      last_heartbeat_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    };
    await writeFile(lockPath, `${JSON.stringify(stale, null, 2)}\n`, "utf8");

    const lock = new AdvisoryLock(lockPath, { heartbeatMs: 60_000, staleMs: 1_000 });
    await lock.acquire();

    const body = JSON.parse(await readFile(lockPath, "utf8")) as LockFileBody;
    expect(body.pid).toBe(process.pid);
    expect(body.pid).not.toBe(999_999);

    await lock.release();
  });

  test("does NOT take over a fresh lock even with a tiny staleMs if heartbeat is current", async () => {
    // Writer A holds with current heartbeat.
    const a = new AdvisoryLock(lockPath, { heartbeatMs: 60_000, staleMs: 60_000 });
    await a.acquire();

    const b = new AdvisoryLock(lockPath, { heartbeatMs: 60_000, staleMs: 60_000 });
    let caught: unknown;
    try {
      await b.acquire();
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_LOCK_HELD");

    await a.release();
  });

  test("recovers from a malformed lock file (treats it as stale)", async () => {
    await writeFile(lockPath, "this is not json", "utf8");
    const lock = new AdvisoryLock(lockPath, { staleMs: 1_000, heartbeatMs: 60_000 });
    await lock.acquire();
    expect(lock.isAcquired()).toBe(true);
    await lock.release();
  });
});

describe("AdvisoryLock — heartbeat", () => {
  test("heartbeat advances last_heartbeat_at while held", async () => {
    const lock = new AdvisoryLock(lockPath, {
      heartbeatMs: 20,
      staleMs: 60_000,
    });
    await lock.acquire();
    const before = JSON.parse(await readFile(lockPath, "utf8")) as LockFileBody;

    await sleep(80);

    const after = JSON.parse(await readFile(lockPath, "utf8")) as LockFileBody;
    expect(Date.parse(after.last_heartbeat_at)).toBeGreaterThan(
      Date.parse(before.last_heartbeat_at),
    );
    expect(after.started_at).toBe(before.started_at);

    await lock.release();
  });
});
