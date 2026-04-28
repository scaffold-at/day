import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

const KST_NOW = "2026-04-29T08:00:00+09:00";

const indexPath = (h: string) => path.join(h, "todos/active/index.json");
const detailDir = (h: string) => path.join(h, "todos/active/detail");

async function readIndex(home: string) {
  return JSON.parse(await readFile(indexPath(home), "utf8"));
}

async function seedTodo(home: string, title = "draft"): Promise<string> {
  const r = await runCli(
    ["todo", "add", "--title", title, "--duration-min", "60", "--json"],
    { home, env: { SCAFFOLD_DAY_NOW: KST_NOW } },
  );
  return JSON.parse(r.stdout).id;
}

describe("rebuild-index (S64)", () => {
  test("clean home → no drift, exit 0", async () => {
    await runCli(["init", "--force"], { home });
    await seedTodo(home, "first");
    await seedTodo(home, "second");

    const r = await runCli(["rebuild-index", "--json"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.todos.detail_count).toBe(2);
    expect(out.todos.added).toBe(0);
    expect(out.todos.removed).toBe(0);
    expect(out.todos.changed).toBe(0);
  });

  test("manually deleted detail file → 'removed' drift, index reconciles", async () => {
    await runCli(["init", "--force"], { home });
    const id = await seedTodo(home, "to-be-orphaned");
    // Delete the detail file out of band.
    await unlink(path.join(detailDir(home), `${id}.json`));

    // Pre-state: index still references it.
    const before = await readIndex(home);
    expect(before.summaries.find((s: { id: string }) => s.id === id)).toBeDefined();

    const r = await runCli(["rebuild-index", "--json"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.todos.removed).toBe(1);

    // Post-state: index drops the orphan.
    const after = await readIndex(home);
    expect(after.summaries.find((s: { id: string }) => s.id === id)).toBeUndefined();
  });

  test("manually added detail file → 'added' drift", async () => {
    await runCli(["init", "--force"], { home });
    const id = await seedTodo(home, "tracked");

    // Hand-write a new detail file (id mirrors the filename).
    const newId = "todo_01zzhandadd0ab";
    const newDetail = {
      id: newId,
      title: "hand-added",
      status: "open",
      tags: [],
      importance_score: null,
      duration_min: null,
      target_date: null,
      created_at: KST_NOW,
      updated_at: KST_NOW,
      description: null,
      reasoning: null,
      history: [
        { at: KST_NOW, by: "user", kind: "created", notes: null, patch: null },
      ],
      importance: null,
    };
    await mkdir(detailDir(home), { recursive: true });
    await writeFile(
      path.join(detailDir(home), `${newId}.json`),
      JSON.stringify(newDetail, null, 2),
    );

    const r = await runCli(["rebuild-index", "--json"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.todos.added).toBe(1);
    expect(out.todos.detail_count).toBe(2);

    const after = await readIndex(home);
    expect(after.summaries.find((s: { id: string }) => s.id === newId)).toBeDefined();
    expect(after.summaries.find((s: { id: string }) => s.id === id)).toBeDefined();
  });

  test("--dry-run reports drift but does not write the index", async () => {
    await runCli(["init", "--force"], { home });
    const id = await seedTodo(home, "still-here");
    await unlink(path.join(detailDir(home), `${id}.json`));

    const before = await readIndex(home);
    const r = await runCli(["rebuild-index", "--dry-run", "--json"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.dry_run).toBe(true);
    expect(out.would.command).toBe("rebuild-index");
    expect(out.would.result.todos.removed).toBe(1);

    // Index unchanged on disk.
    const after = await readIndex(home);
    expect(after).toEqual(before);
  });

  test("--scope todos skips day manifests", async () => {
    await runCli(["init", "--force"], { home });
    await seedTodo(home);
    const r = await runCli(["rebuild-index", "--scope", "todos", "--json"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.todos).toBeDefined();
    expect(out.days).toBeUndefined();
  });

  test("--scope unknown → DAY_INVALID_INPUT", async () => {
    await runCli(["init", "--force"], { home });
    const r = await runCli(["rebuild-index", "--scope", "bogus"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });
});
