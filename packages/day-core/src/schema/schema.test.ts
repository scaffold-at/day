import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isScaffoldError } from "../error";
import {
  backupsRoot,
  compareSchemaVersions,
  compareSemVer,
  createMigrationBackup,
  CURRENT_SCHEMA_VERSION,
  findMigrationPath,
  isSchemaVersion,
  metaDir,
  parseSemVer,
  readSchemaVersionFile,
  schemaVersionPath,
  writeSchemaVersionFile,
  type Migrator,
  type SchemaVersion,
  type SchemaVersionFile,
} from "./index";

describe("semver helpers", () => {
  test("parseSemVer accepts X.Y.Z", () => {
    expect(parseSemVer("0.1.0")).toEqual([0, 1, 0]);
    expect(parseSemVer("12.34.56")).toEqual([12, 34, 56]);
  });

  test("parseSemVer rejects malformed input", () => {
    expect(() => parseSemVer("0.1")).toThrow(/invalid schema version/);
    expect(() => parseSemVer("0.1.0-rc.1")).toThrow();
    expect(() => parseSemVer("v0.1.0")).toThrow();
  });

  test("compareSemVer orders correctly", () => {
    expect(compareSemVer([0, 1, 0], [0, 1, 0])).toBe(0);
    expect(compareSemVer([0, 1, 0], [0, 2, 0])).toBe(-1);
    expect(compareSemVer([0, 2, 0], [0, 1, 9])).toBe(1);
    expect(compareSemVer([1, 0, 0], [0, 99, 99])).toBe(1);
  });

  test("compareSchemaVersions wraps the parsing", () => {
    expect(compareSchemaVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareSchemaVersions("0.1.0", "0.2.0")).toBe(-1);
    expect(compareSchemaVersions("1.0.0", "0.99.99")).toBe(1);
  });

  test("isSchemaVersion narrows", () => {
    expect(isSchemaVersion("0.1.0")).toBe(true);
    expect(isSchemaVersion("0.1")).toBe(false);
    expect(isSchemaVersion("v0.1.0")).toBe(false);
  });
});

describe("findMigrationPath", () => {
  const m = (from: SchemaVersion, to: SchemaVersion, description = "test"): Migrator => ({
    from,
    to,
    description,
    apply: async () => {},
  });

  test("equal versions → empty chain", () => {
    expect(findMigrationPath("0.1.0", "0.1.0", [])).toEqual([]);
  });

  test("missing chain → null", () => {
    expect(findMigrationPath("0.1.0", "0.2.0", [])).toBeNull();
  });

  test("single hop", () => {
    const reg = [m("0.1.0", "0.2.0")];
    const path = findMigrationPath("0.1.0", "0.2.0", reg);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(path![0]?.to).toBe("0.2.0");
  });

  test("multi-hop chain", () => {
    const reg = [m("0.1.0", "0.2.0"), m("0.2.0", "0.3.0"), m("0.3.0", "1.0.0")];
    const path = findMigrationPath("0.1.0", "1.0.0", reg);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(3);
    expect(path!.map((s) => s.to)).toEqual(["0.2.0", "0.3.0", "1.0.0"]);
  });

  test("cycle returns null", () => {
    const reg = [m("0.1.0", "0.2.0"), m("0.2.0", "0.1.0")];
    expect(findMigrationPath("0.1.0", "1.0.0", reg)).toBeNull();
  });
});

describe("schema-version file storage", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "scaffold-day-schema-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  test("read fails with DAY_NOT_INITIALIZED when file is missing", async () => {
    await expect(readSchemaVersionFile(home)).rejects.toMatchObject({
      code: "DAY_NOT_INITIALIZED",
    });
  });

  test("write creates the meta dir then read returns the same payload", async () => {
    const payload: SchemaVersionFile = {
      schema_version: CURRENT_SCHEMA_VERSION,
      created_at: "2026-04-26T00:00:00.000Z",
      last_migrated_at: null,
      scaffold_day_version: "0.0.0",
    };
    await writeSchemaVersionFile(home, payload);
    const got = await readSchemaVersionFile(home);
    expect(got).toEqual(payload);
  });

  test("read fails with DAY_INVALID_INPUT when JSON is malformed", async () => {
    await mkdir(metaDir(home), { recursive: true });
    await writeFile(schemaVersionPath(home), "{not json", "utf8");
    try {
      await readSchemaVersionFile(home);
      throw new Error("should have thrown");
    } catch (err) {
      expect(isScaffoldError(err)).toBe(true);
      if (isScaffoldError(err)) expect(err.code).toBe("DAY_INVALID_INPUT");
    }
  });

  test("read fails with DAY_INVALID_INPUT when schema_version is not X.Y.Z", async () => {
    await mkdir(metaDir(home), { recursive: true });
    await writeFile(
      schemaVersionPath(home),
      JSON.stringify({ schema_version: "v0.1" }),
      "utf8",
    );
    try {
      await readSchemaVersionFile(home);
      throw new Error("should have thrown");
    } catch (err) {
      expect(isScaffoldError(err)).toBe(true);
      if (isScaffoldError(err)) expect(err.code).toBe("DAY_INVALID_INPUT");
    }
  });
});

describe("createMigrationBackup", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "scaffold-day-backup-"));
    await writeSchemaVersionFile(home, {
      schema_version: CURRENT_SCHEMA_VERSION,
      created_at: "2026-04-26T00:00:00.000Z",
      last_migrated_at: null,
      scaffold_day_version: "0.0.0",
    });
    // Sample data file so we can verify the copy.
    await mkdir(path.join(home, "todos"), { recursive: true });
    await writeFile(path.join(home, "todos", "active.json"), "[]", "utf8");
    // A "lock" file that should be skipped.
    await writeFile(path.join(metaDir(home), "lock"), "stale", "utf8");
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  test("snapshots data into .scaffold-day/.backups/<ts>/ and skips lock + nested backups", async () => {
    const dest = await createMigrationBackup(home);
    expect(dest.startsWith(backupsRoot(home))).toBe(true);

    // schema-version.json copied
    const copied = await readFile(
      path.join(dest, ".scaffold-day", "schema-version.json"),
      "utf8",
    );
    expect(JSON.parse(copied).schema_version).toBe(CURRENT_SCHEMA_VERSION);

    // todos copied
    const todo = await readFile(path.join(dest, "todos", "active.json"), "utf8");
    expect(todo).toBe("[]");

    // lock NOT copied
    let lockExists = false;
    try {
      await stat(path.join(dest, ".scaffold-day", "lock"));
      lockExists = true;
    } catch {}
    expect(lockExists).toBe(false);

    // backups/<ts>/.scaffold-day/.backups should NOT exist (no recursion)
    let nestedBackup = false;
    try {
      await stat(path.join(dest, ".scaffold-day", ".backups"));
      nestedBackup = true;
    } catch {}
    expect(nestedBackup).toBe(false);
  });

  test("two consecutive backups produce distinct directories", async () => {
    const a = await createMigrationBackup(home);
    // Bump time deterministically by 1ms so timestamps differ even on fast disks.
    await new Promise((r) => setTimeout(r, 5));
    const b = await createMigrationBackup(home);
    expect(a).not.toBe(b);
  });
});
