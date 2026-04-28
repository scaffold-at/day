import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome({ uninitialized: true });
});
afterEach(async () => {
  await cleanupHome(home);
});

const schemaPath = (h: string) =>
  path.join(h, ".scaffold-day", "schema-version.json");

async function readSchema(home: string) {
  return JSON.parse(await readFile(schemaPath(home), "utf8"));
}

describe("last_seen_binary_version (v0.2.2)", () => {
  test("init writes scaffold_day_version + last_seen_binary_version equal to current", async () => {
    const r = await runCli(["init"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const file = await readSchema(home);
    expect(file.scaffold_day_version).toBe("0.2.2");
    expect(file.last_seen_binary_version).toBe("0.2.2");
  });

  test("subsequent commands update last_seen_binary_version when stale", async () => {
    // Simulate an older v0.1.0 home: scaffold_day_version is 0.1.0
    // and last_seen_binary_version is missing.
    await runCli(["init"], { home });
    const before = await readSchema(home);
    await writeFile(
      schemaPath(home),
      JSON.stringify(
        {
          ...before,
          scaffold_day_version: "0.1.0",
          last_seen_binary_version: "0.1.0",
        },
        null,
        2,
      ),
    );

    // Any non-init / non-dry-run command should refresh last_seen.
    await runCli(["today", "--tz", "Asia/Seoul"], { home });

    const after = await readSchema(home);
    expect(after.scaffold_day_version).toBe("0.1.0"); // immutable
    expect(after.last_seen_binary_version).toBe("0.2.2"); // refreshed
  });

  test("dry-run does NOT touch last_seen_binary_version", async () => {
    await runCli(["init"], { home });
    const before = await readSchema(home);
    await writeFile(
      schemaPath(home),
      JSON.stringify(
        { ...before, last_seen_binary_version: "0.1.0" },
        null,
        2,
      ),
    );

    await runCli(["today", "--dry-run", "--tz", "Asia/Seoul"], { home });
    const after = await readSchema(home);
    expect(after.last_seen_binary_version).toBe("0.1.0");
  });

  test("doctor surfaces both fingerprints", async () => {
    await runCli(["init"], { home });
    const r = await runCli(["doctor"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("data schema: 0.1.0");
    expect(r.stdout).toContain("initialized by: scaffold-day v0.2.2");
    expect(r.stdout).toContain("last seen by:");
    expect(r.stdout).toContain("current binary: scaffold-day v0.2.2");
  });

  test("v0.2.2 home (no last_seen field) doesn't break doctor", async () => {
    await runCli(["init"], { home });
    const before = await readSchema(home);
    delete before.last_seen_binary_version;
    await writeFile(schemaPath(home), JSON.stringify(before, null, 2));

    const r = await runCli(["doctor"], { home });
    expect(r.exitCode).toBe(0);
    // last_seen line should NOT appear when the field is absent on disk
    // until the next non-init command writes it back.
    expect(r.stdout).toContain("data schema: 0.1.0");
  });
});
