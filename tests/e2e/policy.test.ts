import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

describe("policy preset apply / show / patch", () => {
  test("preset apply balanced creates policy/current.yaml", async () => {
    const r = await runCli(["policy", "preset", "apply", "balanced"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("wrote policy/current.yaml");
    const yaml = await readFile(path.join(home, "policy/current.yaml"), "utf8");
    expect(yaml).toContain("balanced preset");
    expect(yaml).toContain("Asia/Seoul");
    expect(yaml).toMatch(/placement_grid_min:\s*30/);
  });

  test("preset apply with unknown name → DAY_INVALID_INPUT", async () => {
    const r = await runCli(["policy", "preset", "apply", "wild"], { home });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
    expect(r.stderr).toContain("'wild'");
  });

  test("policy show before preset apply → DAY_NOT_INITIALIZED", async () => {
    const r = await runCli(["policy", "show"], { home });
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("DAY_NOT_INITIALIZED");
  });

  test("policy show prints the YAML; --json prints the compiled object", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });

    const yaml = await runCli(["policy", "show"], { home });
    expect(yaml.exitCode).toBe(0);
    expect(yaml.stdout).toContain("placement_grid_min: 30");

    const json = await runCli(["policy", "show", "--json"], { home });
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.context.tz).toBe("Asia/Seoul");
    expect(parsed.placement_grid_min).toBe(30);
    expect(parsed.preset).toBe("balanced");
  });

  test("policy patch flips placement_grid_min and preserves the header comment", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });

    const patch = JSON.stringify([
      { op: "replace", path: "/placement_grid_min", value: 15 },
    ]);
    const r = await runCli(["policy", "patch", patch], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("applied 1 op");

    const yaml = await readFile(path.join(home, "policy/current.yaml"), "utf8");
    expect(yaml).toContain("balanced preset"); // header preserved
    expect(yaml).toMatch(/placement_grid_min:\s*15/);
    expect(yaml).not.toMatch(/placement_grid_min:\s*30/);
  });

  test("policy patch with bad JSON → DAY_INVALID_INPUT", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const r = await runCli(["policy", "patch", "{not json"], { home });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });

  test("policy patch that violates the schema → DAY_INVALID_INPUT", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const r = await runCli(
      [
        "policy",
        "patch",
        JSON.stringify([{ op: "remove", path: "/context/tz" }]),
      ],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });

  test("policy patch before preset apply → DAY_NOT_INITIALIZED", async () => {
    const r = await runCli(
      [
        "policy",
        "patch",
        JSON.stringify([{ op: "replace", path: "/placement_grid_min", value: 15 }]),
      ],
      { home },
    );
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("DAY_NOT_INITIALIZED");
  });
});
