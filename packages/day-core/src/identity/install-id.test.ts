import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  installIdPath,
  readInstallId,
  readOrCreateInstallId,
  resetInstallId,
} from "./install-id";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-identity-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("install-id", () => {
  test("readOrCreateInstallId creates a fresh UUID when none exists", async () => {
    expect(await readInstallId(home)).toBeNull();
    const id = await readOrCreateInstallId(home);
    expect(id).toMatch(UUID_RE);
    const onDisk = (await readFile(installIdPath(home), "utf8")).trim();
    expect(onDisk).toBe(id);
  });

  test("readOrCreateInstallId returns the same id on repeat calls", async () => {
    const a = await readOrCreateInstallId(home);
    const b = await readOrCreateInstallId(home);
    expect(a).toBe(b);
  });

  test("malformed file is replaced on next read", async () => {
    await readOrCreateInstallId(home);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(installIdPath(home), "not-a-uuid\n");
    const next = await readOrCreateInstallId(home);
    expect(next).toMatch(UUID_RE);
    expect(next).not.toBe("not-a-uuid");
  });

  test("resetInstallId issues a fresh UUID", async () => {
    const a = await readOrCreateInstallId(home);
    const b = await resetInstallId(home);
    expect(b).toMatch(UUID_RE);
    expect(b).not.toBe(a);
  });

  test("readInstallId returns null without writing when file is absent", async () => {
    expect(await readInstallId(home)).toBeNull();
    // Still null — readInstallId should not have created one.
    expect(await readInstallId(home)).toBeNull();
  });
});
