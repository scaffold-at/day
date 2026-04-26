import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicWrite } from "./atomic-write";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "scaffold-day-atomicwrite-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("atomicWrite — happy path", () => {
  test("creates a new file with the given content", async () => {
    const target = path.join(dir, "data.json");
    await atomicWrite(target, '{"a":1}');
    expect(await readFile(target, "utf8")).toBe('{"a":1}');
  });

  test("creates parent directories as needed", async () => {
    const target = path.join(dir, "deep", "nested", "data.json");
    await atomicWrite(target, "ok");
    expect(await readFile(target, "utf8")).toBe("ok");
  });

  test("overwrites an existing file in one shot", async () => {
    const target = path.join(dir, "data.txt");
    await writeFile(target, "old", "utf8");
    await atomicWrite(target, "new");
    expect(await readFile(target, "utf8")).toBe("new");
  });

  test("accepts Uint8Array content", async () => {
    const target = path.join(dir, "bin.dat");
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    await atomicWrite(target, bytes);
    const back = await readFile(target);
    expect(Array.from(back)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  test("does not leave any .tmp siblings on success", async () => {
    const target = path.join(dir, "data.json");
    await atomicWrite(target, "ok");
    const entries = await readdir(dir);
    const tmpEntries = entries.filter((e) => e.endsWith(".tmp"));
    expect(tmpEntries).toEqual([]);
  });

  test("applies the requested mode on a new file", async () => {
    const target = path.join(dir, "secret.txt");
    await atomicWrite(target, "hush", { mode: 0o600 });
    const st = await stat(target);
    // Mask perm bits — 0o777 — and check the 0o600 surface.
    expect(st.mode & 0o777).toBe(0o600);
  });
});

describe("atomicWrite — failure semantics", () => {
  test("throwing mid-write does not corrupt the target and cleans tmp", async () => {
    const target = path.join(dir, "data.txt");
    await writeFile(target, "ORIGINAL", "utf8");

    // Force a failure by passing a content type that .writeFile can't handle.
    let threw = false;
    try {
      await atomicWrite(target, 12345 as unknown as string);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Original content preserved.
    expect(await readFile(target, "utf8")).toBe("ORIGINAL");

    // No tmp leaks.
    const entries = await readdir(dir);
    const tmpEntries = entries.filter((e) => e.endsWith(".tmp"));
    expect(tmpEntries).toEqual([]);
  });
});

describe("atomicWrite — concurrency", () => {
  test("concurrent writers all succeed; final content equals exactly one writer's output", async () => {
    const target = path.join(dir, "race.txt");
    const writers = Array.from({ length: 16 }, (_, i) => `writer-${i}`);

    const results = await Promise.allSettled(
      writers.map((w) => atomicWrite(target, w)),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilled).toBe(writers.length);

    const final = await readFile(target, "utf8");
    expect(writers).toContain(final);

    // No tmp leaks even under contention.
    const entries = await readdir(dir);
    const tmpEntries = entries.filter((e) => e.endsWith(".tmp"));
    expect(tmpEntries).toEqual([]);
  });

  test("concurrent reads during writes never observe a partial file", async () => {
    const target = path.join(dir, "stream.json");
    await atomicWrite(target, JSON.stringify({ generation: 0 }));

    const writes = Array.from({ length: 32 }, (_, i) =>
      atomicWrite(target, JSON.stringify({ generation: i + 1 })),
    );

    const reads: Promise<unknown>[] = [];
    for (let i = 0; i < 32; i++) {
      reads.push(
        readFile(target, "utf8").then((text) => {
          const parsed = JSON.parse(text);
          expect(typeof parsed.generation).toBe("number");
          return parsed;
        }),
      );
    }

    await Promise.all([...writes, ...reads]);
    const final = JSON.parse(await readFile(target, "utf8"));
    expect(typeof final.generation).toBe("number");
  });
});
