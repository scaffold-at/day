import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

describe("doctor (S35)", () => {
  test("default human output covers all sections", async () => {
    const r = await runCli(["doctor"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("scaffold-day · doctor");
    expect(r.stdout).toContain("Environment");
    expect(r.stdout).toContain("AI Providers");
    expect(r.stdout).toContain("Adapters");
    expect(r.stdout).toContain("data schema: 0.1.0");
    expect(r.stdout).toContain("bun:");
    expect(r.stdout).toContain("Summary:");
  });

  test("--json emits a structured shape with sections + providers + summary", async () => {
    const r = await runCli(["doctor", "--json"], { home });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.home).toBe(home);
    expect(Array.isArray(out.sections)).toBe(true);
    expect(out.sections.map((s: { title: string }) => s.title)).toEqual([
      "Environment",
      "Anchor",
      "AI Providers",
      "Adapters",
    ]);
    expect(Array.isArray(out.providers)).toBe(true);
    const mock = out.providers.find((p: { id: string }) => p.id === "mock");
    expect(mock).toBeDefined();
    expect(mock.available).toBe(true);
    expect(mock.capabilities.tier).toBe(1);
    expect(typeof mock.roundtrip_ms).toBe("number");
    expect(typeof out.summary.ok).toBe("number");
  });

  test("policy presence flips the policy line from warn → ok after preset apply", async () => {
    const beforeApply = await runCli(["doctor", "--json"], { home });
    const beforeJson = JSON.parse(beforeApply.stdout);
    const envBefore = beforeJson.sections.find(
      (s: { title: string }) => s.title === "Environment",
    );
    const policyLineBefore = envBefore.lines.find((l: { text: string }) =>
      l.text.includes("policy/current.yaml"),
    );
    expect(policyLineBefore.status).toBe("warn");

    await runCli(["policy", "preset", "apply", "balanced"], { home });

    const afterApply = await runCli(["doctor", "--json"], { home });
    const afterJson = JSON.parse(afterApply.stdout);
    const envAfter = afterJson.sections.find(
      (s: { title: string }) => s.title === "Environment",
    );
    const policyLineAfter = envAfter.lines.find((l: { text: string }) =>
      l.text.includes("policy/current.yaml"),
    );
    expect(policyLineAfter.status).toBe("ok");
  });

  test("uninitialized home produces warn lines without throwing", async () => {
    const fresh = await makeTmpHome({ uninitialized: true });
    try {
      const r = await runCli(["doctor", "--json"], { home: fresh });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      const env = out.sections.find((s: { title: string }) => s.title === "Environment");
      const schemaLine = env.lines.find((l: { text: string }) =>
        l.text.includes("data schema"),
      );
      expect(schemaLine.status).toBe("warn");
    } finally {
      await cleanupHome(fresh);
    }
  });

  test("--probe flag runs roundtrip on every available provider", async () => {
    const r = await runCli(["doctor", "--json", "--probe"], { home });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    const mock = out.providers.find((p: { id: string }) => p.id === "mock");
    expect(typeof mock.roundtrip_ms).toBe("number");
  });

  test("unexpected flag → DAY_USAGE", async () => {
    const r = await runCli(["doctor", "--bogus"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
  });
});
