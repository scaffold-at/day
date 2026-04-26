import {
  appendPlacementLog,
  compilePolicy,
  defaultHomeDir,
  entityIdSchemaOf,
  evaluateHardRules,
  FsDayStore,
  FsTodoRepository,
  generateEntityId,
  ISODateTimeSchema,
  type Placement,
  readPolicyYaml,
  ScaffoldError,
  writePolicySnapshot,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

const InputSchema = z
  .object({
    todo_id: entityIdSchemaOf("todo"),
    slot: ISODateTimeSchema,
    lock: z.boolean().optional(),
    by: z.string().min(1).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const inputJsonSchema = {
  type: "object",
  properties: {
    todo_id: { type: "string", pattern: "^todo_[a-z0-9]{14}$" },
    slot: { type: "string", description: "ISO 8601 datetime with explicit TZ (e.g. 2026-04-27T10:00:00+09:00)" },
    lock: { type: "boolean", description: "Mark the placement locked so replan won't move it." },
    by: { type: "string", description: "Attribution (default: 'ai' for MCP calls)." },
  },
  required: ["todo_id", "slot"],
  additionalProperties: false,
} as const;

function offsetForTzAtDate(date: string, tz: string): string {
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

export const placeTodoTool: Tool<Input, unknown> = {
  name: "place_todo",
  description:
    "Commit a placement for `todo_id` at `slot`. Validates against Hard Rules and existing event/placement overlaps. Writes the placement log (action: placed) BEFORE mutating the day file. Returns the freshly committed Placement with inline snapshot + policy_hash.",
  inputSchema: inputJsonSchema,
  parser: InputSchema,
  handler: async (input: Input) => {
    const home = defaultHomeDir();
    const yaml = await readPolicyYaml(home);
    if (!yaml) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "no policy/current.yaml yet" },
        cause: "place_todo needs the policy.",
        try: ["Apply a preset (e.g. balanced) before calling this tool."],
      });
    }
    const policy = compilePolicy(yaml);
    const todoRepo = new FsTodoRepository(home);
    const detail = await todoRepo.getDetail(input.todo_id);
    if (!detail) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: `todo '${input.todo_id}' not found` },
        cause: `No active todo exists with id '${input.todo_id}'.`,
        try: ["Call query_todos for available ids."],
      });
    }
    if (detail.duration_min == null) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: "todo has no duration_min" },
        cause: `Todo '${input.todo_id}' has no duration_min.`,
        try: ["Set duration_min on the todo first."],
      });
    }

    const slotStartMs = Date.parse(input.slot);
    const slotEndMs = slotStartMs + detail.duration_min * 60_000;
    const slotEnd = new Date(slotEndMs).toISOString();
    // Resolve the calendar date in the policy's TZ rather than the slot
    // string's literal offset — suggestPlacements emits UTC `Z` slots,
    // so naive `slot.slice(0,10)` would yank the wrong day after the
    // KST boundary. The same TZ is used to anchor hard-rule HH:MM
    // ranges (no_placement_in, etc.) below.
    const tzOffset = offsetForTzAtDate(input.slot.slice(0, 10), policy.context.tz);
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: policy.context.tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(slotStartMs));

    const dayStore = new FsDayStore(home);
    const day = await dayStore.readDay(date);

    const hardCheck = evaluateHardRules(
      { start: input.slot, end: slotEnd, duration_min: detail.duration_min },
      policy.hard_rules,
      {
        date,
        todoTags: detail.tags,
        events: day.events,
        placements: day.placements,
        tzOffset,
      },
    );
    if (!hardCheck.ok) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: "slot violates hard rules" },
        cause: hardCheck.violations.map((v) => `${v.rule.kind}: ${v.reason}`).join("\n"),
        try: ["Call suggest_placement to find a valid slot."],
        context: { violations: hardCheck.violations.length },
      });
    }
    for (const e of day.events) {
      if (slotStartMs < Date.parse(e.end) && Date.parse(e.start) < slotEndMs) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `slot overlaps event '${e.title}'` },
          cause: `Event ${e.id} occupies ${e.start} - ${e.end}.`,
          try: ["Pick a non-overlapping slot."],
        });
      }
    }
    for (const p of day.placements) {
      if (slotStartMs < Date.parse(p.end) && Date.parse(p.start) < slotEndMs) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `slot overlaps placement ${p.id}` },
          cause: `Existing placement covers ${p.start} - ${p.end}.`,
          try: ["Pick a non-overlapping slot."],
        });
      }
    }

    const hash = await writePolicySnapshot(home, policy);
    const placedAt = new Date().toISOString();
    const by = input.by ?? "ai";
    const placement: Placement = {
      id: generateEntityId("placement"),
      todo_id: detail.id,
      start: input.slot,
      end: slotEnd,
      title: detail.title,
      tags: [...detail.tags],
      importance_score: detail.importance?.score ?? detail.importance_score ?? null,
      importance_at_placement: detail.importance ?? null,
      duration_min: detail.duration_min,
      placed_by: by === "user" || by === "auto" ? by : "ai",
      placed_at: placedAt,
      policy_hash: hash,
      locked: input.lock ?? false,
    };

    await appendPlacementLog(home, {
      schema_version: "0.1.0",
      at: placedAt,
      action: "placed",
      placement_id: placement.id,
      todo_id: placement.todo_id,
      date,
      start: placement.start,
      end: placement.end,
      by,
      policy_hash: hash,
      reason: null,
      previous: null,
    });
    await dayStore.addPlacement(date, placement);

    return placement;
  },
};
