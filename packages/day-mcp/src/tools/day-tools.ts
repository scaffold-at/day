import {
  defaultHomeDir,
  FsDayStore,
  ISODateSchema,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

const YYYYMM_RE_SRC = "^\\d{4}-(0[1-9]|1[0-2])$";

// ─── get_days_range ────────────────────────────────────────────────

const RangeInput = z
  .object({
    start: ISODateSchema,
    end: ISODateSchema,
    tz: z.string().min(1).optional(),
  })
  .strict();
type RangeIn = z.infer<typeof RangeInput>;

function shiftDays(date: string, delta: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}

export const getDaysRangeTool: Tool<RangeIn, unknown> = {
  name: "get_days_range",
  description:
    "Per-day summary counts (events / placements / conflicts_open) over the inclusive [start, end] date range. Read-only, manifest-driven (no per-day file scan).",
  inputSchema: {
    type: "object",
    properties: {
      start: { type: "string", description: "YYYY-MM-DD (inclusive)" },
      end: { type: "string", description: "YYYY-MM-DD (inclusive)" },
      tz: { type: "string", description: "IANA tz, default system" },
    },
    required: ["start", "end"],
    additionalProperties: false,
  },
  parser: RangeInput,
  handler: async (input: RangeIn) => {
    if (Date.parse(`${input.end}T00:00:00Z`) < Date.parse(`${input.start}T00:00:00Z`)) {
      throw new Error("end must be on or after start");
    }
    const store = new FsDayStore(defaultHomeDir());
    const days: Array<{
      date: string;
      events_count: number;
      placements_count: number;
      conflicts_open_count: number;
    }> = [];
    let cursor = input.start;
    let safety = 0;
    while (cursor <= input.end && safety < 366) {
      const day = await store.readDay(cursor);
      days.push({
        date: cursor,
        events_count: day.events.length,
        placements_count: day.placements.length,
        conflicts_open_count: day.conflicts_open.length,
      });
      cursor = shiftDays(cursor, 1);
      safety++;
    }
    return {
      range_start: input.start,
      range_end: input.end,
      tz: input.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      days,
    };
  },
};

// ─── list_available_months ─────────────────────────────────────────

const MonthsInput = z.object({}).strict();
type MonthsIn = z.infer<typeof MonthsInput>;

export const listAvailableMonthsTool: Tool<MonthsIn, unknown> = {
  name: "list_available_months",
  description:
    "List YYYY-MM partition keys present under <home>/days/. Used by AI clients to discover the data corpus before zooming in.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  parser: MonthsInput,
  handler: async () => {
    const store = new FsDayStore(defaultHomeDir());
    return { months: await store.listMonths() };
  },
};

// ─── get_month_overview ────────────────────────────────────────────

const OverviewInput = z
  .object({
    month: z.string().regex(new RegExp(YYYYMM_RE_SRC)),
  })
  .strict();
type OverviewIn = z.infer<typeof OverviewInput>;

export const getMonthOverviewTool: Tool<OverviewIn, unknown> = {
  name: "get_month_overview",
  description:
    "Return the manifest for one YYYY-MM partition (per-day event/placement/conflict counts + updated_at). Returns `{month, days: []}` when the month has no data yet.",
  inputSchema: {
    type: "object",
    properties: { month: { type: "string", pattern: YYYYMM_RE_SRC } },
    required: ["month"],
    additionalProperties: false,
  },
  parser: OverviewInput,
  handler: async (input: OverviewIn) => {
    const store = new FsDayStore(defaultHomeDir());
    const manifest = await store.readManifest(input.month);
    return manifest ?? { month: input.month, days: [] };
  },
};
