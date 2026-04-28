/**
 * Process-scope clock with a test override path.
 *
 * Why this exists: v0.2's relative time model (sleep budget,
 * cognitive load decay, rest-break suggestion) compares "now" against
 * an anchor recorded earlier in the day. Tests need that comparison
 * to be deterministic; production needs the system clock.
 *
 * The override is read from `SCAFFOLD_DAY_NOW` (an ISO 8601 string
 * with TZ) at every call to `now()`. That env-var path is what
 * subprocess-based e2e tests use — they cannot inject an in-process
 * stub because each `runCli()` spawns a fresh process.
 *
 * In-process unit tests can also flip the override via
 * `setNowOverride(date)` / `clearNowOverride()`.
 */

let inProcessOverride: Date | null = null;

/** Force `now()` to return `at` until cleared. Test-only. */
export function setNowOverride(at: Date | string | null): void {
  if (at === null) {
    inProcessOverride = null;
    return;
  }
  inProcessOverride = typeof at === "string" ? new Date(at) : at;
}

/** Drop any in-process override; restore system-clock behavior. */
export function clearNowOverride(): void {
  inProcessOverride = null;
}

/**
 * Read the current time. Resolution priority:
 *   1. `setNowOverride()` (in-process tests)
 *   2. `SCAFFOLD_DAY_NOW` env var (subprocess tests)
 *   3. system clock
 */
export function now(): Date {
  if (inProcessOverride !== null) {
    return new Date(inProcessOverride);
  }
  const env = typeof process !== "undefined" ? process.env?.SCAFFOLD_DAY_NOW : undefined;
  if (env) {
    const parsed = new Date(env);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

/**
 * Resolve "today" in the given IANA timezone as a `YYYY-MM-DD` string,
 * using `now()` so the env-var override is honored.
 */
export function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now());
}
