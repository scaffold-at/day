import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

const idPath = (h: string) => path.join(h, ".install-id");
const cfgPath = (h: string) => path.join(h, ".telemetry.json");

describe("telemetry (S65)", () => {
  test("status default → ask, no install_id yet", async () => {
    const r = await runCli(["telemetry", "--json"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.state).toBe("ask");
    expect(out.install_id).toBeNull();
    expect(out.transport_configured).toBe(false);
  });

  test("opt in writes config + creates install_id", async () => {
    const r = await runCli(["telemetry", "on", "--json"], { home });
    expect(r.exitCode).toBe(0);
    const cfg = JSON.parse(await readFile(cfgPath(home), "utf8"));
    expect(cfg.state).toBe("on");
    expect(cfg.decided_at).toBeTruthy();
    const id = (await readFile(idPath(home), "utf8")).trim();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("opt off then back to ask round-trips correctly", async () => {
    await runCli(["telemetry", "on"], { home });
    await runCli(["telemetry", "off"], { home });
    const r = await runCli(["telemetry", "--json"], { home });
    expect(JSON.parse(r.stdout).state).toBe("off");

    await runCli(["telemetry", "ask"], { home });
    const r2 = await runCli(["telemetry", "--json"], { home });
    expect(JSON.parse(r2.stdout).state).toBe("ask");
  });

  test("show-id surfaces the current id", async () => {
    await runCli(["telemetry", "on"], { home });
    const r = await runCli(["telemetry", "show-id"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("reset-id issues a fresh id", async () => {
    await runCli(["telemetry", "on"], { home });
    const a = (await runCli(["telemetry", "show-id"], { home })).stdout.trim();
    const r = await runCli(["telemetry", "reset-id", "--json"], { home });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.old).toBe(a);
    expect(out.new).not.toBe(a);
    const cur = (await runCli(["telemetry", "show-id"], { home })).stdout.trim();
    expect(cur).toBe(out.new);
  });

  test("--dry-run does not write config or install_id", async () => {
    const r = await runCli(["telemetry", "on", "--dry-run", "--json"], { home });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.dry_run).toBe(true);
    let cfgExists = true;
    try {
      await stat(cfgPath(home));
    } catch {
      cfgExists = false;
    }
    expect(cfgExists).toBe(false);
  });

  test("unknown subcommand → DAY_USAGE", async () => {
    const r = await runCli(["telemetry", "weather"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
  });
});
