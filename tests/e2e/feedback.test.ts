import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

describe("feedback (S66) — unconfigured transport", () => {
  test("missing message → DAY_USAGE", async () => {
    const r = await runCli(["feedback"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("required");
  });

  test("--json shows full payload preview without sending", async () => {
    const r = await runCli(
      ["feedback", "this command is confusing", "--json"],
      {
        home,
        env: { /* no FEEDBACK_URL */ },
      },
    );
    // No transport configured → exit 0 with guidance to GitHub Issues.
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.message).toBe("this command is confusing");
    expect(out.install_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.scaffold_day_version).toBeTruthy();
    expect(out.doctor_bundle).toBeNull();
    // stderr carries the GitHub fallback notice.
    expect(r.stderr).toContain("github.com/scaffold-at/day/issues");
  });

  test("--include-doctor attaches a redacted bundle", async () => {
    await runCli(["init", "--force"], { home });
    const r = await runCli(
      ["feedback", "broken thing", "--include-doctor", "--json"],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.include_doctor).toBe(true);
    expect(out.doctor_bundle).not.toBeNull();
    expect(out.doctor_bundle.policy_present).toBe(true);
    expect(out.doctor_bundle.platform).toBeTruthy();
    // Redaction sanity: no full path strings, no tz / wall-clock anchor times
    const json = JSON.stringify(out.doctor_bundle);
    expect(json).not.toMatch(/\/Users\//);
    expect(json).not.toMatch(/\/home\//);
  });

  test("over-long message → DAY_INVALID_INPUT", async () => {
    const big = "x".repeat(2000);
    const r = await runCli(["feedback", big], { home });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
    expect(r.stderr).toContain("exceeds");
  });

  test("--dry-run prints a structured plan and writes nothing", async () => {
    const r = await runCli(
      ["feedback", "preview only", "--dry-run", "--json"],
      { home },
    );
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.dry_run).toBe(true);
    expect(out.would.command).toBe("feedback");
    expect(out.would.result.message).toBe("preview only");
  });

  test("install_id is reused across feedback calls (and shared with telemetry)", async () => {
    const a = await runCli(["feedback", "first", "--json"], { home });
    const b = await runCli(["feedback", "second", "--json"], { home });
    const idA = JSON.parse(a.stdout).install_id;
    const idB = JSON.parse(b.stdout).install_id;
    expect(idA).toBe(idB);

    const tStatus = await runCli(["telemetry", "show-id"], { home });
    expect(tStatus.stdout.trim()).toBe(idA);
  });
});
