#!/usr/bin/env bun
/**
 * Bun compatibility smoke test.
 *
 * Asserts the runtime APIs Scaffold Day relies on are present and behave
 * as expected on the current `bun` build. This catches regressions before
 * we hit them in production code (especially around `bun build --compile`,
 * see PRD §12 risk R1).
 *
 * Run: `bun run scripts/bun-compat-smoke.ts` (or `bun run smoke`).
 * Exit 0 = all checks pass. Non-zero = first failure printed to stderr.
 */

const MIN_BUN = { major: 1, minor: 1 };

type Check = { name: string; run: () => Promise<void> | void };

const checks: Check[] = [
  {
    name: "bun version >= 1.1",
    run: () => {
      const parts = Bun.version.split(".").map((n) => Number.parseInt(n, 10));
      const major = parts[0] ?? 0;
      const minor = parts[1] ?? 0;
      if (major < MIN_BUN.major || (major === MIN_BUN.major && minor < MIN_BUN.minor)) {
        throw new Error(
          `bun >= ${MIN_BUN.major}.${MIN_BUN.minor} required, got ${Bun.version}`,
        );
      }
    },
  },
  {
    name: "Bun.file readable",
    run: async () => {
      const f = Bun.file(import.meta.path);
      const text = await f.text();
      if (!text.includes("Bun compatibility smoke test")) {
        throw new Error("Bun.file did not return expected contents");
      }
    },
  },
  {
    name: "Bun.spawn echoes",
    run: async () => {
      const proc = Bun.spawn(["echo", "scaffold-day"], { stdout: "pipe" });
      const out = await new Response(proc.stdout).text();
      const code = await proc.exited;
      if (code !== 0 || !out.includes("scaffold-day")) {
        throw new Error(`Bun.spawn echo failed: code=${code} out=${out.trim()}`);
      }
    },
  },
  {
    name: "fetch() globally available",
    run: () => {
      if (typeof fetch !== "function") throw new Error("global fetch missing");
    },
  },
  {
    name: "atomic-ish Bun.write tmp + rename",
    run: async () => {
      const tmp = `${require("node:os").tmpdir()}/scaffold-day-smoke-${Date.now()}`;
      await Bun.write(tmp, "ok");
      const back = await Bun.file(tmp).text();
      if (back !== "ok") throw new Error("Bun.write round-trip failed");
      await Bun.file(tmp).delete();
    },
  },
];

let failed = 0;
for (const check of checks) {
  try {
    await check.run();
    console.log(`  ✓ ${check.name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${check.name}: ${msg}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} bun compat check(s) failed on bun ${Bun.version}`);
  process.exit(1);
}
console.log(`\nbun ${Bun.version} compat smoke OK (${checks.length} checks)`);
