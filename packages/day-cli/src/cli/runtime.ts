/**
 * Process-scope runtime context for the CLI.
 *
 * `--dry-run` is a global flag handled in `dispatch()` (it is stripped
 * from `argv` before the command runs). Write commands check
 * `isDryRun()` and, instead of touching disk, emit a structured
 * preview via `emitDryRun()` and return 0.
 *
 * Why a global rather than a parameter on `Command.run`:
 *   - 21 commands; mechanical signature change for one cross-cutting
 *     concern is more churn than the win.
 *   - The CLI is invoked once per process (no shared loop, no test
 *     re-entry). Tests spawn a subprocess so process-scoped state is
 *     fresh per test.
 */

let dryRun = false;

export function setDryRun(value: boolean): void {
  dryRun = value;
}

export function isDryRun(): boolean {
  return dryRun;
}

/** Reset between in-process callers (only used by unit tests). */
export function resetRuntimeForTests(): void {
  dryRun = false;
}

export type DryRunWrite = {
  /** Path relative to the scaffold-day home (or absolute for /tmp etc.). */
  path: string;
  op: "create" | "update" | "delete";
  /**
   * Optional structured snapshot of what would be written. JSON-friendly;
   * Date and other custom types should already be serialised.
   */
  preview?: unknown;
};

export type DryRunPlan = {
  /** Logical command label, e.g. "todo add" or "place do". */
  command: string;
  /** Disk side-effects that would have happened. */
  writes: DryRunWrite[];
  /**
   * Optional structured "result" payload — what the command would have
   * printed (or returned via --json) on success.
   */
  result?: unknown;
  /** Optional human note / explanation. */
  note?: string;
};

/**
 * Print a dry-run plan in the format matching the caller's mode.
 *
 *  - JSON  → `{ "dry_run": true, "would": <plan> }`
 *  - human → `[dry-run] <command>` + indented write list + indented result
 */
export function emitDryRun(jsonMode: boolean, plan: DryRunPlan): void {
  if (jsonMode) {
    console.log(JSON.stringify({ dry_run: true, would: plan }, null, 2));
    return;
  }

  console.log(`[dry-run] ${plan.command}`);
  if (plan.writes.length === 0) {
    console.log("  (no disk writes)");
  } else {
    for (const w of plan.writes) {
      console.log(`  would ${w.op.padEnd(6)} ${w.path}`);
    }
  }
  if (plan.note) {
    console.log(`  note: ${plan.note}`);
  }
  if (plan.result !== undefined) {
    console.log("  would print:");
    const text =
      typeof plan.result === "string"
        ? plan.result
        : JSON.stringify(plan.result, null, 2);
    for (const line of text.split("\n")) {
      console.log(`    ${line}`);
    }
  }
}
