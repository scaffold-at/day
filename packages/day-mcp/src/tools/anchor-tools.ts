import {
  buildHeartbeat,
  compilePolicy,
  computeRestSuggestion,
  defaultHomeDir,
  now,
  readAnchorForDate,
  readPolicyYaml,
  recordAnchor,
  ScaffoldError,
  todayInTz,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

function shiftDate(date: string, delta: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}

async function resolveTz(home: string): Promise<string> {
  const yaml = await readPolicyYaml(home);
  if (yaml) {
    try {
      const policy = compilePolicy(yaml);
      if (policy.context?.tz) return policy.context.tz;
    } catch {
      // fall through
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// ─── record_morning ────────────────────────────────────────────────

const RecordMorningInputSchema = z
  .object({
    at: z
      .string()
      .optional()
      .describe(
        "Optional ISO 8601 (with TZ) instant to record. Defaults to now.",
      ),
    force: z
      .boolean()
      .optional()
      .describe(
        "Overwrite an existing explicit/manual anchor for today. Auto-anchors are always upgraded silently.",
      ),
  })
  .strict();
type RecordMorningInput = z.infer<typeof RecordMorningInputSchema>;

type RecordMorningOutput = {
  anchor: string;
  date: string;
  source: "explicit" | "manual" | "auto";
  was_already_set: boolean;
  upgraded_from_auto: boolean;
  recorded: boolean;
};

export const recordMorningTool: Tool<RecordMorningInput, RecordMorningOutput> = {
  name: "record_morning",
  description:
    "Record today's morning anchor (t=0 of the relative time model). Call on the user's morning greeting. Idempotent w/o force; auto-anchors silently upgrade.",
  inputSchema: {
    type: "object",
    properties: {
      at: {
        type: "string",
        description:
          "Optional ISO 8601 datetime with TZ. If omitted, the current wall-clock instant is used.",
      },
      force: {
        type: "boolean",
        description:
          "Overwrite an existing explicit/manual anchor for today.",
      },
    },
    additionalProperties: false,
  },
  parser: RecordMorningInputSchema,
  handler: async (input): Promise<RecordMorningOutput> => {
    const home = defaultHomeDir();
    const tz = await resolveTz(home);
    const recordedAt = now();

    let at: Date;
    if (input.at) {
      at = new Date(input.at);
      if (Number.isNaN(at.getTime())) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: "record_morning: 'at' must be ISO 8601 with TZ" },
          cause: `Got: ${input.at}`,
          try: ["Pass at: '2026-04-28T07:30:00+09:00'."],
        });
      }
    } else {
      at = recordedAt;
    }

    const source = input.at ? "manual" : "explicit";
    const entry = buildHeartbeat({ at, recordedAt, source, tz });

    const existing = await readAnchorForDate(home, entry.date);
    const wasExplicitlySet =
      existing !== null &&
      (existing.source === "explicit" || existing.source === "manual");
    const upgradeAuto = existing?.source === "auto";

    const result = await recordAnchor(home, entry, {
      force: Boolean(input.force) || upgradeAuto,
    });
    const recorded = !wasExplicitlySet || Boolean(input.force);

    return {
      anchor: result.entry.anchor,
      date: result.entry.date,
      source: result.entry.source,
      was_already_set: wasExplicitlySet,
      upgraded_from_auto: upgradeAuto && recorded,
      recorded,
    };
  },
};

// ─── get_morning_anchor ────────────────────────────────────────────

const GetMorningAnchorInputSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe(
        "Optional YYYY-MM-DD. Defaults to today in the policy timezone.",
      ),
  })
  .strict();
type GetMorningAnchorInput = z.infer<typeof GetMorningAnchorInputSchema>;

type GetMorningAnchorOutput = {
  date: string;
  anchor: string | null;
  source: "explicit" | "manual" | "auto" | null;
  recorded_at: string | null;
};

// ─── get_rest_suggestion ───────────────────────────────────────────

const GetRestSuggestionInputSchema = z.object({}).strict();
type GetRestSuggestionInput = z.infer<typeof GetRestSuggestionInputSchema>;

type GetRestSuggestionOutput = {
  suggest: boolean;
  measured_sleep_hours: number | null;
  break_min: number;
  reason: string;
};

export const getRestSuggestionTool: Tool<
  GetRestSuggestionInput,
  GetRestSuggestionOutput
> = {
  name: "get_rest_suggestion",
  description:
    "Compute today's rest-break suggestion from yesterday→today anchors vs sleep_budget.min_hours. Volatile (no on-disk record). Read-only.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  parser: GetRestSuggestionInputSchema,
  handler: async (_input): Promise<GetRestSuggestionOutput> => {
    const home = defaultHomeDir();
    const tz = await resolveTz(home);
    const today = todayInTz(tz);
    const yesterday = shiftDate(today, -1);

    const yamlText = await readPolicyYaml(home);
    const budget = yamlText
      ? compilePolicy(yamlText).context.sleep_budget ?? null
      : null;

    const todayAnchor = await readAnchorForDate(home, today);
    const yesterdayAnchor = await readAnchorForDate(home, yesterday);

    const r = computeRestSuggestion({
      todayAnchor,
      yesterdayAnchor,
      budget,
    });
    return {
      suggest: r.suggest,
      measured_sleep_hours: r.measured_sleep_hours,
      break_min: r.break_min,
      reason: r.reason,
    };
  },
};

export const getMorningAnchorTool: Tool<
  GetMorningAnchorInput,
  GetMorningAnchorOutput
> = {
  name: "get_morning_anchor",
  description:
    "Read the morning anchor for a date (default: today). Null if not yet recorded. Read-only.",
  inputSchema: {
    type: "object",
    properties: {
      date: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "YYYY-MM-DD; defaults to today.",
      },
    },
    additionalProperties: false,
  },
  parser: GetMorningAnchorInputSchema,
  handler: async (input): Promise<GetMorningAnchorOutput> => {
    const home = defaultHomeDir();
    const tz = await resolveTz(home);
    const date = input.date ?? todayInTz(tz);
    const entry = await readAnchorForDate(home, date);
    if (!entry) {
      return { date, anchor: null, source: null, recorded_at: null };
    }
    return {
      date: entry.date,
      anchor: entry.anchor,
      source: entry.source,
      recorded_at: entry.recorded_at,
    };
  },
};
