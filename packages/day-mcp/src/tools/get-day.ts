import {
  computeFreeSlots,
  defaultHomeDir,
  FsDayStore,
  ISODateSchema,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

const InputSchema = z
  .object({
    date: ISODateSchema,
    tz: z.string().min(1).optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const inputJsonSchema = {
  type: "object",
  properties: {
    date: { type: "string", description: "YYYY-MM-DD" },
    tz: { type: "string", description: "IANA timezone (defaults to system)" },
  },
  required: ["date"],
  additionalProperties: false,
} as const;

function offsetForDate(date: string, tz: string): string {
  try {
    const sample = new Date(`${date}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
      hour: "numeric",
    });
    const part = fmt.formatToParts(sample).find((p) => p.type === "timeZoneName");
    if (!part || part.value === "GMT") return "+00:00";
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part.value);
    if (!m) return "+00:00";
    const sign = m[1] ?? "+";
    const hh = (m[2] ?? "0").padStart(2, "0");
    const mm = (m[3] ?? "00").padStart(2, "0");
    return `${sign}${hh}:${mm}`;
  } catch {
    return "+00:00";
  }
}

export const getDayTool: Tool<Input, unknown> = {
  name: "get_day",
  description:
    "Return the day view for a single calendar date: events + placements + freshly computed free_slots + summary counts. Read-only. v0.1 working window is 09:00-18:00 in the user TZ with a protected lunch 12:00-13:00 (Policy-aware window arrives in §S13 wiring).",
  inputSchema: inputJsonSchema,
  parser: InputSchema,
  handler: async (input: Input) => {
    const home = defaultHomeDir();
    const tz = input.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    const off = offsetForDate(input.date, tz);
    const store = new FsDayStore(home);
    const day = await store.readDay(input.date);

    const free = computeFreeSlots(day, {
      windowStart: `${input.date}T09:00:00${off}`,
      windowEnd: `${input.date}T18:00:00${off}`,
      protectedRanges: [
        { start: `${input.date}T12:00:00${off}`, end: `${input.date}T13:00:00${off}`, label: "lunch" },
      ],
      gridMin: 30,
      bufferMin: 0,
    });
    return {
      date: input.date,
      tz,
      events: day.events,
      placements: day.placements,
      free_slots: free,
      conflicts_open: day.conflicts_open,
      summary: {
        events_count: day.events.length,
        placements_count: day.placements.length,
        free_slots_count: free.length,
        conflicts_open_count: day.conflicts_open.length,
      },
    };
  },
};
