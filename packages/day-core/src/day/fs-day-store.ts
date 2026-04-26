import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ScaffoldError } from "../error";
import { atomicWrite } from "../fs/atomic-write";
import { CURRENT_SCHEMA_VERSION } from "../schema/version";
import { type Day, DaySchema } from "./day";
import type { FixedEvent } from "./event";
import type { Placement } from "./placement";

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

function invalid(file: string, reason: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_INVALID_INPUT",
    summary: {
      en: `failed to parse ${file}`,
      ko: `${file} 파싱 실패`,
    },
    cause: reason,
    try: ["Restore the file from a backup under .scaffold-day/.backups/."],
    context: { file },
  });
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YYYYMM_RE = /^\d{4}-\d{2}$/;

/**
 * Filesystem day store (PRD §9.1, SLICES §S9).
 *
 * Layout under `<home>/days/`:
 *   <YYYY-MM>/<YYYY-MM-DD>.json   — Day file
 *
 * Reads of missing days return an empty Day. Writes are atomic via
 * `atomicWrite`. Single-process by design — caller holds an
 * AdvisoryLock (§S8b) across mutations.
 */
export class FsDayStore {
  constructor(public readonly home: string) {}

  daysDir(): string {
    return path.join(this.home, "days");
  }

  monthDir(month: string): string {
    return path.join(this.daysDir(), month);
  }

  dayPath(date: string): string {
    const month = date.slice(0, 7);
    return path.join(this.monthDir(month), `${date}.json`);
  }

  /**
   * Read a Day file. Returns an empty Day for that date if the file
   * does not exist yet. Throws DAY_INVALID_INPUT if the file is
   * malformed.
   */
  async readDay(date: string): Promise<Day> {
    if (!ISO_DATE_RE.test(date)) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `invalid date '${date}'`, ko: `잘못된 날짜 '${date}'` },
        cause: "Date must match YYYY-MM-DD.",
        try: ["Pass an ISO calendar date such as 2026-04-26."],
        context: { date },
      });
    }
    const p = this.dayPath(date);
    try {
      const raw = await readFile(p, "utf8");
      const parsed = DaySchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw invalid(p, parsed.error.message);
      return parsed.data;
    } catch (err) {
      if (isEnoent(err)) return this.emptyDay(date);
      throw err;
    }
  }

  /** Atomically rewrite the entire Day file. */
  async writeDay(day: Day): Promise<void> {
    const parsed = DaySchema.safeParse(day);
    if (!parsed.success) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: "Day does not pass schema validation" },
        cause: parsed.error.message,
        try: ["Inspect the Day object before writing."],
        context: { date: day.date },
      });
    }
    const p = this.dayPath(day.date);
    await mkdir(path.dirname(p), { recursive: true });
    await atomicWrite(p, `${JSON.stringify(parsed.data, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  /** Append a FixedEvent to the day; create the file if needed. */
  async addEvent(date: string, event: FixedEvent): Promise<Day> {
    const day = await this.readDay(date);
    day.events.push(event);
    await this.writeDay(day);
    return day;
  }

  /** Append a Placement to the day; create the file if needed. */
  async addPlacement(date: string, placement: Placement): Promise<Day> {
    const day = await this.readDay(date);
    day.placements.push(placement);
    await this.writeDay(day);
    return day;
  }

  /** List YYYY-MM-DD dates that have a day file under the given month. */
  async listMonth(month: string): Promise<string[]> {
    if (!YYYYMM_RE.test(month)) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `invalid month '${month}'` },
        cause: "Month must match YYYY-MM.",
        try: ["Pass a string like 2026-04."],
        context: { month },
      });
    }
    try {
      const entries = await readdir(this.monthDir(month));
      return entries
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .filter((d) => ISO_DATE_RE.test(d) && d.startsWith(month))
        .sort();
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
  }

  /** List YYYY-MM partition keys present under days/. */
  async listMonths(): Promise<string[]> {
    try {
      const entries = await readdir(this.daysDir());
      return entries.filter((f) => YYYYMM_RE.test(f)).sort();
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
  }

  private emptyDay(date: string): Day {
    return {
      schema_version: CURRENT_SCHEMA_VERSION,
      date,
      events: [],
      placements: [],
      conflicts_open: [],
    };
  }
}
