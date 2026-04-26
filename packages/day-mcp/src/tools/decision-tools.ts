import {
  appendConflictLog,
  appendPlacementLog,
  compilePolicy,
  type Conflict,
  ConflictStatusSchema,
  type Day,
  defaultHomeDir,
  detectConflicts,
  entityIdSchemaOf,
  evaluateHardRules,
  FsDayStore,
  FsTodoRepository as TodoRepoCtor,
  generateEntityId,
  type ImportanceDimensions,
  ImportanceDimensionsSchema,
  ISODateSchema,
  ISODateTimeSchema,
  makeTaskImportance,
  type Placement,
  readConflicts,
  readPolicySnapshot,
  readPolicyYaml,
  replanDay,
  ScaffoldError,
  suggestPlacements,
  syncConflicts,
  writeConflicts,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

const PlacementIdSchema = entityIdSchemaOf("placement");
const TodoIdSchema = entityIdSchemaOf("todo");
const ConflictIdSchema = entityIdSchemaOf("conflict");

// ─── place_override ────────────────────────────────────────────────

const OverrideInput = z
  .object({
    placement_id: PlacementIdSchema,
    new_slot: ISODateTimeSchema,
    reason: z.string().min(1).optional(),
    by: z.string().min(1).optional(),
  })
  .strict();
type OverrideIn = z.infer<typeof OverrideInput>;

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

async function findPlacement(
  home: string,
  placementId: string,
): Promise<{ placement: Placement; date: string } | null> {
  const store = new FsDayStore(home);
  const months = await store.listMonths();
  for (const m of months) {
    const dates = await store.listMonth(m);
    for (const d of dates) {
      const day = await store.readDay(d);
      const match = day.placements.find((p) => p.id === placementId);
      if (match) return { placement: match, date: d };
    }
  }
  return null;
}

export const placeOverrideTool: Tool<OverrideIn, unknown> = {
  name: "place_override",
  description:
    "Move an existing placement to a new slot. Validates against hard rules + overlaps; writes a placement log entry (action: overridden) before the day file. Same-day moves mutate in place; cross-day moves remove from old day and add to new.",
  inputSchema: {
    type: "object",
    properties: {
      placement_id: { type: "string", pattern: "^plc_[a-z0-9]{14}$" },
      new_slot: { type: "string", description: "ISO 8601 datetime with TZ" },
      reason: { type: "string" },
      by: { type: "string" },
    },
    required: ["placement_id", "new_slot"],
    additionalProperties: false,
  },
  parser: OverrideInput,
  handler: async (input: OverrideIn) => {
    const home = defaultHomeDir();
    const yaml = await readPolicyYaml(home);
    if (!yaml) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "no policy/current.yaml yet" },
        cause: "place_override needs the policy.",
        try: ["Apply a preset first."],
      });
    }
    const policy = compilePolicy(yaml);
    const found = await findPlacement(home, input.placement_id);
    if (!found) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: `placement '${input.placement_id}' not found` },
        cause: "No day file under <home>/days/ contains a placement with this id.",
        try: ["Inspect via get_days_range or get_month_overview."],
        context: { placement_id: input.placement_id },
      });
    }

    const newStartMs = Date.parse(input.new_slot);
    const newEndMs = newStartMs + found.placement.duration_min * 60_000;
    const newSlotEnd = new Date(newEndMs).toISOString();
    const dayStore = new FsDayStore(home);
    const newDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: policy.context.tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(newStartMs));
    const tzOffset = offsetForTzAtDate(newDate, policy.context.tz);

    const destDay =
      newDate === found.date
        ? await dayStore.readDay(found.date)
        : await dayStore.readDay(newDate);

    const others = destDay.placements.filter((p) => p.id !== input.placement_id);
    const hard = evaluateHardRules(
      { start: input.new_slot, end: newSlotEnd, duration_min: found.placement.duration_min },
      policy.hard_rules,
      {
        date: newDate,
        todoTags: found.placement.tags,
        events: destDay.events,
        placements: others,
        tzOffset,
      },
    );
    if (!hard.ok) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: "new_slot violates hard rules" },
        cause: hard.violations.map((v) => `${v.rule.kind}: ${v.reason}`).join("\n"),
        try: ["Pick a different new_slot."],
      });
    }
    for (const e of destDay.events) {
      if (newStartMs < Date.parse(e.end) && Date.parse(e.start) < newEndMs) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `new_slot overlaps event '${e.title}'` },
          cause: `Event ${e.id} occupies ${e.start} - ${e.end}.`,
          try: ["Pick a non-overlapping slot."],
        });
      }
    }
    for (const p of others) {
      if (newStartMs < Date.parse(p.end) && Date.parse(p.start) < newEndMs) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `new_slot overlaps placement ${p.id}` },
          cause: `Existing placement covers ${p.start} - ${p.end}.`,
          try: ["Pick a non-overlapping slot."],
        });
      }
    }

    const overriddenAt = new Date().toISOString();
    const previous = { start: found.placement.start, end: found.placement.end };
    const updated: Placement = {
      ...found.placement,
      start: input.new_slot,
      end: newSlotEnd,
    };
    const by = input.by ?? "ai";

    await appendPlacementLog(home, {
      schema_version: "0.1.0",
      at: overriddenAt,
      action: "overridden",
      placement_id: input.placement_id,
      todo_id: found.placement.todo_id,
      date: newDate,
      start: updated.start,
      end: updated.end,
      by,
      policy_hash: found.placement.policy_hash ?? null,
      reason: input.reason ?? null,
      previous,
    });

    if (newDate === found.date) {
      const day = await dayStore.readDay(found.date);
      day.placements = day.placements.map((p) =>
        p.id === input.placement_id ? updated : p,
      );
      await dayStore.writeDay(day);
    } else {
      const oldDay = await dayStore.readDay(found.date);
      oldDay.placements = oldDay.placements.filter((p) => p.id !== input.placement_id);
      await dayStore.writeDay(oldDay);
      await dayStore.addPlacement(newDate, updated);
    }

    return { placement: updated, previous, reason: input.reason ?? null };
  },
};

// ─── replan_day ────────────────────────────────────────────────────

const ReplanInput = z
  .object({
    date: ISODateSchema,
    scope: z.enum(["flexible_only", "all_unlocked"]).optional(),
  })
  .strict();
type ReplanIn = z.infer<typeof ReplanInput>;

export const replanDayTool: Tool<ReplanIn, unknown> = {
  name: "replan_day",
  description:
    "Auto-rearrange a day's flexible / unlocked placements via the placement engine. Logs every move + emits capacity_exceeded conflicts for drops. Locked + (in flexible_only scope) user placements are preserved.",
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD" },
      scope: { type: "string", enum: ["flexible_only", "all_unlocked"] },
    },
    required: ["date"],
    additionalProperties: false,
  },
  parser: ReplanInput,
  handler: async (input: ReplanIn) => {
    const home = defaultHomeDir();
    const yaml = await readPolicyYaml(home);
    if (!yaml) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "no policy/current.yaml yet" },
        cause: "replan_day needs the policy.",
        try: ["Apply a preset first."],
      });
    }
    const policy = compilePolicy(yaml);
    const dayStore = new FsDayStore(home);
    const day = await dayStore.readDay(input.date);
    const outcome = replanDay(day, policy, input.scope ?? "flexible_only");

    const at = new Date().toISOString();
    for (const move of outcome.moved) {
      await appendPlacementLog(home, {
        schema_version: "0.1.0",
        at,
        action: "overridden",
        placement_id: move.placement.id,
        todo_id: move.placement.todo_id,
        date: input.date,
        start: move.placement.start,
        end: move.placement.end,
        by: "auto",
        policy_hash: move.placement.policy_hash ?? null,
        reason: `replan ${input.scope ?? "flexible_only"}`,
        previous: move.previous,
      });
    }
    for (const drop of outcome.dropped) {
      await appendPlacementLog(home, {
        schema_version: "0.1.0",
        at,
        action: "removed",
        placement_id: drop.id,
        todo_id: drop.todo_id,
        date: input.date,
        start: drop.start,
        end: drop.end,
        by: "auto",
        policy_hash: drop.policy_hash ?? null,
        reason: `replan ${input.scope ?? "flexible_only"} dropped`,
        previous: { start: drop.start, end: drop.end },
      });
    }

    day.placements = outcome.final_placements;
    await dayStore.writeDay(day);

    const dropped: Conflict[] = outcome.dropped.map((p) => ({
      id: generateEntityId("conflict"),
      date: input.date,
      kind: "capacity_exceeded" as const,
      detected_at: at,
      detector: "replan",
      party_ids: [p.id],
      detail: `replan dropped placement ${p.id} (${p.duration_min} min)`,
      hard_rule_kind: null,
      status: "open" as const,
      resolved_at: null,
      resolved_by: null,
      resolution: null,
    }));
    const detected = [
      ...detectConflicts({ ...day, placements: outcome.final_placements }, policy, {
        detector: "replan",
      }),
      ...dropped,
    ];
    const { openIdsForDate } = await syncConflicts(home, input.date, detected);
    day.conflicts_open = openIdsForDate;
    await dayStore.writeDay(day);

    return {
      date: input.date,
      scope: input.scope ?? "flexible_only",
      kept: outcome.kept_in_place.length,
      moved: outcome.moved.length,
      dropped: outcome.dropped.length,
      open_conflicts: openIdsForDate.length,
    };
  },
};

// ─── explain_placement ─────────────────────────────────────────────

const ExplainInput = z.object({ placement_id: PlacementIdSchema }).strict();
type ExplainIn = z.infer<typeof ExplainInput>;

export const explainPlacementTool: Tool<ExplainIn, unknown> = {
  name: "explain_placement",
  description:
    "Return the chosen reason + ranked alternatives + policy snapshot meta for an existing placement. Replays the suggest engine against the policy in effect at placement time.",
  inputSchema: {
    type: "object",
    properties: {
      placement_id: { type: "string", pattern: "^plc_[a-z0-9]{14}$" },
    },
    required: ["placement_id"],
    additionalProperties: false,
  },
  parser: ExplainInput,
  handler: async (input: ExplainIn) => {
    const home = defaultHomeDir();
    const found = await findPlacement(home, input.placement_id);
    if (!found) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: `placement '${input.placement_id}' not found` },
        cause: "No day file contains a placement with this id.",
        try: ["Inspect via get_days_range."],
      });
    }
    let policySnapshotMeta: { hash: string; captured_at: string } | null = null;
    let policy = null as ReturnType<typeof compilePolicy> | null;
    if (found.placement.policy_hash) {
      const snap = await readPolicySnapshot(home, found.placement.policy_hash);
      if (snap) {
        policy = snap.policy;
        policySnapshotMeta = { hash: snap.hash, captured_at: snap.captured_at };
      }
    }
    if (!policy) {
      const yaml = await readPolicyYaml(home);
      if (!yaml) {
        throw new ScaffoldError({
          code: "DAY_NOT_INITIALIZED",
          summary: { en: "no policy/current.yaml yet" },
          cause: "explain_placement falls back to the current policy when the snapshot is missing.",
          try: ["Apply a preset first."],
        });
      }
      policy = compilePolicy(yaml);
    }

    const todoRepo = new TodoRepoCtor(home);
    const detail = await todoRepo.getDetail(found.placement.todo_id);
    const importanceScore =
      found.placement.importance_at_placement?.score ??
      found.placement.importance_score ??
      detail?.importance?.score ??
      detail?.importance_score ??
      0;

    const dayStore = new FsDayStore(home);
    const day = await dayStore.readDay(found.date);
    const dayWithoutThis: Day = {
      ...day,
      placements: day.placements.filter((p) => p.id !== found.placement.id),
    };
    const suggestion = suggestPlacements({
      todo: {
        id: found.placement.todo_id,
        tags: found.placement.tags,
        duration_min: found.placement.duration_min,
        importance_score: importanceScore,
      },
      daysByDate: new Map([[day.date, dayWithoutThis]]),
      policy,
      max: 5,
    });
    const chosen =
      suggestion.candidates.find((c) => c.start === found.placement.start) ?? null;
    const alternatives = suggestion.candidates.filter(
      (c) => c.start !== found.placement.start,
    );

    return {
      placement: found.placement,
      placed_by: found.placement.placed_by,
      chosen_reason: chosen
        ? `Ranked #${chosen.rank} of ${suggestion.candidates.length} (score ${chosen.score.toFixed(2)}). ${chosen.rationale}`
        : "Slot not in the current top-5; either policy changed or the slot was hand-picked.",
      chosen_breakdown: chosen,
      alternatives,
      policy_snapshot: policySnapshotMeta,
      importance_at_placement: found.placement.importance_at_placement,
    };
  },
};

// ─── resolve_conflict ──────────────────────────────────────────────

const ResolveInput = z
  .object({
    id: ConflictIdSchema,
    status: z.enum(["resolved", "ignored"]),
    reason: z.string().min(1).optional(),
    by: z.string().min(1).optional(),
  })
  .strict();
type ResolveIn = z.infer<typeof ResolveInput>;

export const resolveConflictTool: Tool<ResolveIn, unknown> = {
  name: "resolve_conflict",
  description:
    "Mark a conflict resolved or ignored, append a conflicts.jsonl log entry, and clear the id from the day's conflicts_open[]. Does NOT mutate the underlying placements — call place_override for the actual move/remove.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", pattern: "^cfl_[a-z0-9]{14}$" },
      status: { type: "string", enum: ["resolved", "ignored"] },
      reason: { type: "string" },
      by: { type: "string" },
    },
    required: ["id", "status"],
    additionalProperties: false,
  },
  parser: ResolveInput,
  handler: async (input: ResolveIn) => {
    const home = defaultHomeDir();
    const dayStore = new FsDayStore(home);
    const months = await dayStore.listMonths();
    let found: { conflict: Conflict; month: string } | null = null;
    for (const m of months) {
      const partition = await readConflicts(home, m);
      const c = partition.conflicts.find((x) => x.id === input.id);
      if (c) {
        found = { conflict: c, month: m };
        break;
      }
    }
    if (!found) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: `conflict '${input.id}' not found` },
        cause: "No conflict partition contains this id.",
        try: ["Inspect via list_pending_decisions or query the partition file directly."],
      });
    }
    if (found.conflict.status !== "open") {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `conflict '${input.id}' is already ${found.conflict.status}` },
        cause: "Only open conflicts can be resolved or ignored.",
        try: ["Pick another conflict id."],
      });
    }
    const newStatus = ConflictStatusSchema.parse(input.status);
    const now = new Date().toISOString();
    const partition = await readConflicts(home, found.month);
    partition.conflicts = partition.conflicts.map((c) =>
      c.id === input.id
        ? {
            ...c,
            status: newStatus,
            resolved_at: now,
            resolved_by: input.by ?? "ai",
            resolution: { note: input.reason ?? null },
          }
        : c,
    );
    await writeConflicts(home, partition);

    const day = await dayStore.readDay(found.conflict.date);
    day.conflicts_open = day.conflicts_open.filter((cid) => cid !== input.id);
    await dayStore.writeDay(day);

    await appendConflictLog(home, {
      schema_version: "0.1.0",
      at: now,
      action: newStatus === "ignored" ? "ignored" : "resolved",
      conflict_id: input.id,
      date: found.conflict.date,
      kind: found.conflict.kind,
      party_ids: [...found.conflict.party_ids],
      by: input.by ?? "ai",
      reason: input.reason ?? null,
      resolution: { note: input.reason ?? null },
    });

    return { id: input.id, status: newStatus, reason: input.reason ?? null };
  },
};

// ─── compute_task_importance ──────────────────────────────────────

const ScoreInput = z
  .object({
    todo_id: TodoIdSchema,
    dimensions: ImportanceDimensionsSchema,
    reasoning: z.string().min(1),
    by: z.string().min(1).optional(),
  })
  .strict();
type ScoreIn = {
  todo_id: string;
  dimensions: ImportanceDimensions;
  reasoning: string;
  by?: string;
};

export const computeTaskImportanceTool: Tool<ScoreIn, unknown> = {
  name: "compute_task_importance",
  description:
    "Compute and persist a TaskImportance for a todo using the current policy weights. Updates the todo's importance + importance_score with a 'scored' history entry. Idempotent for identical inputs (same dimensions + same policy → same score + same policy_hash).",
  inputSchema: {
    type: "object",
    properties: {
      todo_id: { type: "string", pattern: "^todo_[a-z0-9]{14}$" },
      dimensions: {
        type: "object",
        properties: {
          urgency: { type: "number", minimum: 0, maximum: 10 },
          impact: { type: "number", minimum: 0, maximum: 10 },
          effort: { type: "number", minimum: 0, maximum: 10 },
          reversibility: { type: "number", minimum: 0, maximum: 10 },
          time_sensitivity: { type: "number", minimum: 0, maximum: 10 },
          external_dependency: { type: "boolean" },
          deadline: { type: "string", enum: ["hard", "soft", "none"] },
        },
        required: ["urgency", "impact", "effort", "reversibility"],
      },
      reasoning: { type: "string", minLength: 1 },
      by: { type: "string" },
    },
    required: ["todo_id", "dimensions", "reasoning"],
    additionalProperties: false,
  },
  parser: ScoreInput,
  handler: async (input: ScoreIn) => {
    const home = defaultHomeDir();
    const yaml = await readPolicyYaml(home);
    if (!yaml) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "no policy/current.yaml yet" },
        cause: "compute_task_importance needs the policy weights.",
        try: ["Apply a preset first."],
      });
    }
    const policy = compilePolicy(yaml);
    const importance = await makeTaskImportance(input.dimensions, policy, {
      reasoning: input.reasoning,
      computedBy: input.by ?? "ai",
    });
    const repo = new TodoRepoCtor(home);
    const updated = await repo.update(input.todo_id, {
      importance,
      by: input.by ?? "ai",
      history_kind: "scored",
      notes: input.reasoning,
    });
    return { id: updated.id, importance: updated.importance };
  },
};

