import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(HERE, "../../packages/day-cli/src/index.ts");

export type CliRun = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunOptions = {
  /** SCAFFOLD_DAY_HOME for the subprocess. Required for any home-aware command. */
  home?: string;
  /** Extra env vars merged on top of process.env. */
  env?: Record<string, string>;
  /** Override the default `NO_COLOR=1` (set to false to keep color env unchanged). */
  keepColor?: boolean;
};

/**
 * Spawn the scaffold-day CLI in a subprocess and capture the result.
 * Defaults `NO_COLOR=1` so stdout/stderr assertions are stable across
 * environments. Use `keepColor: true` if a test specifically needs to
 * exercise color behavior.
 */
export async function runCli(
  args: readonly string[],
  options: RunOptions = {},
): Promise<CliRun> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(options.home ? { SCAFFOLD_DAY_HOME: options.home } : {}),
    ...(options.env ?? {}),
  };
  if (!options.keepColor && env.NO_COLOR === undefined) {
    env.NO_COLOR = "1";
  }
  // E2E tests should never spawn the real `claude` binary even if
  // it's installed on the developer's machine — clamp the catalog
  // to the deterministic mock unless the test explicitly opts out.
  if (env.SCAFFOLD_DAY_AI_PROVIDERS === undefined) {
    env.SCAFFOLD_DAY_AI_PROVIDERS = "mock";
  }
  // Same isolation for telemetry: the binary embeds a default
  // PostHog endpoint + write-only project key, but tests must never
  // POST real events. Empty string disables transport (S65). Tests
  // that explicitly exercise transport can override.
  if (env.SCAFFOLD_DAY_POSTHOG_URL === undefined) {
    env.SCAFFOLD_DAY_POSTHOG_URL = "";
  }
  if (env.SCAFFOLD_DAY_POSTHOG_KEY === undefined) {
    env.SCAFFOLD_DAY_POSTHOG_KEY = "";
  }
  // Same for feedback transport — never POST to the live Worker
  // from e2e tests. Empty string disables transport.
  if (env.SCAFFOLD_DAY_FEEDBACK_URL === undefined) {
    env.SCAFFOLD_DAY_FEEDBACK_URL = "";
  }
  // S73: never touch the developer's real OS Keychain from a test.
  // The token-storage layer transparently falls back to file mode
  // when this env is set. Tests that exercise the keychain path
  // explicitly opt back in.
  if (env.SCAFFOLD_DAY_DISABLE_KEYCHAIN === undefined) {
    env.SCAFFOLD_DAY_DISABLE_KEYCHAIN = "1";
  }

  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

export type MakeTmpHomeOptions = {
  /** Skip seeding `.scaffold-day/schema-version.json`. Default false. */
  uninitialized?: boolean;
  /** Override the seeded schema_version. Default "0.1.0". */
  schemaVersion?: string;
};

export async function makeTmpHome(
  options: MakeTmpHomeOptions = {},
): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "scaffold-day-e2e-"));
  if (!options.uninitialized) {
    await mkdir(path.join(home, ".scaffold-day"), { recursive: true });
    const payload = {
      schema_version: options.schemaVersion ?? "0.1.0",
      created_at: new Date().toISOString(),
      last_migrated_at: null,
      scaffold_day_version: "0.0.0",
    };
    await writeFile(
      path.join(home, ".scaffold-day", "schema-version.json"),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }
  return home;
}

export async function cleanupHome(home: string): Promise<void> {
  if (!home) return;
  await rm(home, { recursive: true, force: true });
}

/** ISO date `YYYY-MM-DD` for "today" in the given TZ (default Asia/Seoul). */
export function todayInTz(tz = "Asia/Seoul"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
