import {
  appendPlacementLog,
  compilePolicy,
  defaultHomeDir,
  evaluateHardRules,
  FsDayStore,
  FsTodoRepository,
  generateEntityId,
  ISODateSchema,
  ISODateTimeSchema,
  type Day,
  type Placement,
  policyHash,
  readAnchorForDate,
  readPolicyYaml,
  ScaffoldError,
  suggestPlacements,
  type SuggestionInput,
  todayInTz as todayInTzCore,
  writePolicySnapshot,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day place --help` for the full input contract.",
    try: ["Run `scaffold-day place --help`."],
  });
}

function shiftDays(date: string, delta: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}

function todayInTz(tz: string): string {
  return todayInTzCore(tz);
}

function offsetForTz(date: string, tz: string): string {
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

// Suggestion candidates are emitted in UTC ("…Z") form. `place do`
// derives the wall-clock-vs-rule check from the slot's offset suffix,
// so feeding a Z-suffixed instant trips local-time rules (e.g.
// 22:00-07:00 no_placement_in) when the slot is fine in the user's TZ.
function utcToLocalIso(utcIso: string, tz: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return utcIso;
  const dateForOffset = new Date(ms).toISOString().slice(0, 10);
  const offset = offsetForTz(dateForOffset, tz);
  const sign = offset[0] === "-" ? -1 : 1;
  const hh = Number.parseInt(offset.slice(1, 3), 10);
  const mm = Number.parseInt(offset.slice(4, 6), 10);
  const offsetMs = sign * (hh * 60 + mm) * 60_000;
  const wall = new Date(ms + offsetMs).toISOString().slice(0, 19);
  return `${wall}${offset}`;
}

async function runSuggest(args: string[]): Promise<number> {
  let id: string | undefined;
  let startDate: string | undefined;
  let days = 7;
  let max = 5;
  let json = false;
  let autoCommit = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!id && !a.startsWith("--")) {
      id = a;
      continue;
    }
    if (a === "--auto") {
      autoCommit = true;
    } else if (a === "--date") {
      startDate = ISODateSchema.parse(args[i + 1]);
      i++;
    } else if (a === "--within") {
      const v = args[i + 1];
      if (!v) throw usage("--within requires a value (e.g. 7)");
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 30) {
        throw usage("--within must be an integer in [1, 30]");
      }
      days = n;
      i++;
    } else if (a === "--max") {
      const v = args[i + 1];
      if (!v) throw usage("--max requires a value");
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        throw usage("--max must be an integer in [1, 50]");
      }
      max = n;
      i++;
    } else if (a === "--json") {
      json = true;
    } else if (a.startsWith("--")) {
      throw usage(`place suggest: unknown option '${a}'`);
    } else {
      throw usage(`place suggest: unexpected argument '${a}'`);
    }
  }
  if (!id) throw usage("place suggest: <todo-id> argument is required");

  const home = defaultHomeDir();
  const yaml = await readPolicyYaml(home);
  if (!yaml) {
    throw new ScaffoldError({
      code: "DAY_NOT_INITIALIZED",
      summary: { en: "no policy/current.yaml yet" },
      cause: "place suggest needs the policy weights + working hours.",
      try: ["Run `scaffold-day policy preset apply balanced`."],
    });
  }
  const policy = compilePolicy(yaml);

  const todoRepo = new FsTodoRepository(home);
  const detail = await todoRepo.getDetail(id);
  if (!detail) {
    throw new ScaffoldError({
      code: "DAY_NOT_FOUND",
      summary: { en: `todo '${id}' not found` },
      cause: `No active todo exists with id '${id}'.`,
      try: ["Run `scaffold-day todo list` to see available ids."],
      context: { id },
    });
  }
  if (detail.duration_min == null) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "todo has no duration_min — can't generate candidates" },
      cause: `Todo '${id}' has no duration_min set.`,
      try: [`Run \`scaffold-day todo update ${id} --duration-min 60\`.`],
    });
  }

  const dayStore = new FsDayStore(home);
  const start = startDate ?? todayInTz(policy.context.tz);
  const daysByDate = new Map<string, Day>();
  for (let i = 0; i < days; i++) {
    const d = shiftDays(start, i);
    daysByDate.set(d, await dayStore.readDay(d));
  }

  // S62: pull yesterday-of-each-day events so the engine can apply
  // the recovery_block soft penalty when yesterday ran late.
  const previousDayByToday = new Map<string, readonly import("@scaffold/day-core").FixedEvent[]>();
  for (let i = 0; i < days; i++) {
    const d = shiftDays(start, i);
    const yesterday = shiftDays(d, -1);
    previousDayByToday.set(d, (await dayStore.readDay(yesterday)).events);
  }

  const importanceScore = detail.importance?.score ?? detail.importance_score ?? 0;
  // S58: pull today's anchor (or the start day's) so the engine can
  // evaluate sleep_budget. Null is fine — the engine skips budget
  // checks then.
  const anchorEntry = await readAnchorForDate(home, start);
  const anchor = anchorEntry
    ? { date: anchorEntry.date, anchor: anchorEntry.anchor }
    : null;
  const input: SuggestionInput = {
    todo: {
      id: detail.id,
      tags: detail.tags,
      duration_min: detail.duration_min,
      importance_score: importanceScore,
    },
    daysByDate,
    policy,
    max,
    anchor,
    previousDayByToday,
  };
  const suggestion = suggestPlacements(input);

  // S81: --auto commits the top candidate (if any) by recursing into
  // `place do`. The suggestion still prints (or returns JSON) so the
  // caller sees the full ranking.
  if (autoCommit) {
    if (suggestion.candidates.length === 0) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: "place suggest --auto: no candidate slot fits" },
        cause: suggestion.no_fit_reason ?? "Empty candidate set.",
        try: ["Adjust --within / --max, or relax policy hard rules."],
      });
    }
    const top = suggestion.candidates[0]!;
    const localSlot = utcToLocalIso(top.start, policy.context.tz);
    if (json) {
      console.log(
        JSON.stringify({ ...suggestion, auto_committed: { rank: 1, slot: localSlot } }, null, 2),
      );
    } else {
      console.log(`scaffold-day place suggest ${id} --auto`);
      console.log(`  committing top candidate: ${localSlot} (rank 1, score ${top.score.toFixed(2)})`);
    }
    return runDo([id, "--slot", localSlot, "--by", "auto", ...(json ? ["--json"] : [])]);
  }

  if (json) {
    console.log(JSON.stringify(suggestion, null, 2));
    return 0;
  }

  console.log(`scaffold-day place suggest ${id}`);
  console.log(`  duration:  ${suggestion.duration_min} min`);
  console.log(`  importance: ${suggestion.importance_score.toFixed(1)}`);
  console.log(`  range:     ${start} → ${shiftDays(start, days - 1)} (${days} day${days === 1 ? "" : "s"})`);
  console.log("");

  if (suggestion.candidates.length === 0) {
    console.log("  no candidates");
    if (suggestion.no_fit_reason) {
      console.log(`  reason: ${suggestion.no_fit_reason}`);
    }
    return 0;
  }

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: policy.context.tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  for (const c of suggestion.candidates) {
    const startHM = fmt.format(new Date(c.start));
    const endHM = fmt.format(new Date(c.end));
    console.log(`  [${c.rank}] ${c.date}  ${startHM}-${endHM}  score: ${c.score.toFixed(2)}`);
    console.log(`        importance:  ${c.importance.toFixed(2)}`);
    console.log(`        soft_total:  ${c.soft_total >= 0 ? "+" : ""}${c.soft_total}`);
    if (c.reactivity_penalty !== 0) {
      console.log(`        reactivity:  ${c.reactivity_penalty}`);
    }
    for (const ctr of c.contributions) {
      console.log(`        + ${ctr.note}`);
    }
  }
  return 0;
}

export const placeCommand: Command = {
  name: "place",
  summary: "rank free slots for a todo (suggest), commit one (do), move one (override)",
  help: {
    what: "Drive the placement engine. `suggest <todo-id>` ranks free slots across the next N days using importance + soft preferences − reactivity. `do` and `override` arrive in §S21 / §S22.",
    when: "When deciding where in the day a todo should land, or when reshuffling after a calendar change.",
    cost: "Local file I/O (policy + day files for the requested range). No network. No mutations from `suggest`.",
    input: "suggest <todo-id> [--date <YYYY-MM-DD>] [--within <N>=7] [--max <K>=5] [--json]\ndo <todo-id> --slot <ISO> [--lock]            (placeholder, §S21)\noverride <placement-id> --new-slot <ISO> [--reason <T>]   (placeholder, §S22)",
    return: "Exit 0. DAY_NOT_INITIALIZED if no policy/current.yaml. DAY_NOT_FOUND for unknown todo. DAY_INVALID_INPUT if the todo has no duration_min. DAY_USAGE on bad flags.",
    gotcha: "`suggest` does not write anything — call `place do` to commit. The Balanced preset's working window (09:00-18:00 weekdays) means a Saturday todo will produce zero candidates until you customize policy. Tracking SLICES.md §S20 (suggest) / §S21 (do) / §S22 (override).",
  },
  run: async (args) => {
    const sub = args[0];
    if (!sub) throw usage("place: missing subcommand. try `place suggest <todo-id>`");
    const rest = args.slice(1);
    if (sub === "suggest") return runSuggest(rest);
    if (sub === "do") return runDo(rest);
    if (sub === "override") return runOverride(rest);
    throw usage(`place: unknown subcommand '${sub}'`);
  },
};

// ─── place do ─────────────────────────────────────────────────────

function offsetFromIso(iso: string): string {
  const m = /([+-]\d{2}):?(\d{2})$|Z$/.exec(iso);
  if (!m) return "+00:00";
  if (iso.endsWith("Z")) return "+00:00";
  return `${m[1]}:${m[2]}`;
}

async function runDo(args: string[]): Promise<number> {
  let id: string | undefined;
  let slot: string | undefined;
  let lock = false;
  let by = "user";
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!id && !a.startsWith("--")) { id = a; continue; }
    if (a === "--slot") { slot = args[i + 1]; i++; }
    else if (a === "--lock") { lock = true; }
    else if (a === "--by") { by = args[i + 1] ?? "user"; i++; }
    else if (a === "--json") { json = true; }
    else throw usage(`place do: unexpected argument '${a}'`);
  }
  if (!id) throw usage("place do: <todo-id> argument is required");
  if (!slot) throw usage("place do: --slot <ISO datetime+TZ> is required");

  const slotCheck = ISODateTimeSchema.safeParse(slot);
  if (!slotCheck.success) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "--slot must be an ISO 8601 datetime with TZ" },
      cause: slotCheck.error.message,
      try: ["Use a value like 2026-04-27T10:00:00+09:00."],
      context: { value: slot },
    });
  }

  const home = defaultHomeDir();
  const yaml = await readPolicyYaml(home);
  if (!yaml) {
    throw new ScaffoldError({
      code: "DAY_NOT_INITIALIZED",
      summary: { en: "no policy/current.yaml yet" },
      cause: "place do needs the policy weights + working hours.",
      try: ["Run `scaffold-day policy preset apply balanced`."],
    });
  }
  const policy = compilePolicy(yaml);

  const todoRepo = new FsTodoRepository(home);
  const detail = await todoRepo.getDetail(id);
  if (!detail) {
    throw new ScaffoldError({
      code: "DAY_NOT_FOUND",
      summary: { en: `todo '${id}' not found` },
      cause: `No active todo exists with id '${id}'.`,
      try: ["Run `scaffold-day todo list` to see available ids."],
      context: { id },
    });
  }
  if (detail.duration_min == null) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "todo has no duration_min — can't commit a placement" },
      cause: `Todo '${id}' has no duration_min set.`,
      try: [`Run \`scaffold-day todo update ${id} --duration-min 60\`.`],
    });
  }

  // Compute slot.end = slot.start + duration_min.
  const slotStartMs = Date.parse(slot);
  const slotEndMs = slotStartMs + detail.duration_min * 60_000;
  const slotEnd = new Date(slotEndMs).toISOString();
  const tzOffset = offsetFromIso(slot);
  const date = slot.slice(0, 10);

  const dayStore = new FsDayStore(home);
  const day = await dayStore.readDay(date);

  // Hard-rule + free-time validation.
  const hardCheck = evaluateHardRules(
    {
      start: slot,
      end: slotEnd,
      duration_min: detail.duration_min,
    },
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
      summary: { en: "slot violates one or more hard rules" },
      cause: hardCheck.violations
        .map((v) => `  ${v.rule.kind}: ${v.reason}`)
        .join("\n"),
      try: [
        "Run `place suggest <todo-id>` to find a valid slot.",
        "Or pick a slot that doesn't overlap events / protected ranges.",
      ],
      context: { violations: hardCheck.violations.length, date, slot },
    });
  }

  // Conflict with existing events / placements (basic overlap check).
  for (const e of day.events) {
    const eStart = Date.parse(e.start);
    const eEnd = Date.parse(e.end);
    if (slotStartMs < eEnd && eStart < slotEndMs) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `slot overlaps event '${e.title}'` },
        cause: `Event ${e.id} occupies ${e.start} - ${e.end}.`,
        try: ["Pick a non-overlapping slot via `place suggest`."],
      });
    }
  }
  for (const p of day.placements) {
    const pStart = Date.parse(p.start);
    const pEnd = Date.parse(p.end);
    if (slotStartMs < pEnd && pStart < slotEndMs) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `slot overlaps placement ${p.id}` },
        cause: `Existing placement covers ${p.start} - ${p.end}.`,
        try: ["Pick a non-overlapping slot via `place suggest`."],
      });
    }
  }

  const placedAt = new Date().toISOString();

  if (isDryRun()) {
    const hash = await policyHash(policy);
    const placement: Placement = {
      id: generateEntityId("placement"),
      todo_id: detail.id,
      start: slot,
      end: slotEnd,
      title: detail.title,
      tags: [...detail.tags],
      importance_score: detail.importance?.score ?? detail.importance_score ?? null,
      importance_at_placement: detail.importance ?? null,
      duration_min: detail.duration_min,
      placed_by: by === "user" || by === "ai" || by === "auto" ? (by as "user" | "ai" | "auto") : "user",
      placed_at: placedAt,
      policy_hash: hash,
      locked: lock,
    };
    emitDryRun(json, {
      command: "place do",
      writes: [
        { path: `policy-snapshots/${hash.slice(0, 12)}.yaml`, op: "create" },
        { path: `logs/${date.slice(0, 7)}/placements.jsonl`, op: "update" },
        { path: `days/${date.slice(0, 7)}/${date}.json`, op: "update" },
        { path: `days/${date.slice(0, 7)}/manifest.json`, op: "update" },
      ],
      result: placement,
    });
    return 0;
  }

  const hash = await writePolicySnapshot(home, policy);
  const placement: Placement = {
    id: generateEntityId("placement"),
    todo_id: detail.id,
    start: slot,
    end: slotEnd,
    title: detail.title,
    tags: [...detail.tags],
    importance_score: detail.importance?.score ?? detail.importance_score ?? null,
    importance_at_placement: detail.importance ?? null,
    duration_min: detail.duration_min,
    placed_by: by === "user" || by === "ai" || by === "auto" ? (by as "user" | "ai" | "auto") : "user",
    placed_at: placedAt,
    policy_hash: hash,
    locked: lock,
  };

  // Transactional order: log → day file.
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

  if (json) {
    console.log(JSON.stringify(placement, null, 2));
    return 0;
  }
  console.log("scaffold-day place do");
  console.log(`  placement: ${placement.id}`);
  console.log(`  todo:      ${placement.todo_id}`);
  console.log(`  when:      ${placement.start} → ${placement.end}`);
  console.log(`  date:      ${date}`);
  console.log(`  locked:    ${placement.locked ? "yes" : "no"}`);
  console.log(`  policy:    ${hash.slice(0, 12)}…`);
  return 0;
}

// ─── place override ───────────────────────────────────────────────

async function runOverride(args: string[]): Promise<number> {
  let placementId: string | undefined;
  let newSlot: string | undefined;
  let reason: string | undefined;
  let by = "user";
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!placementId && !a.startsWith("--")) { placementId = a; continue; }
    if (a === "--new-slot") { newSlot = args[i + 1]; i++; }
    else if (a === "--reason") { reason = args[i + 1]; i++; }
    else if (a === "--by") { by = args[i + 1] ?? "user"; i++; }
    else if (a === "--json") { json = true; }
    else throw usage(`place override: unexpected argument '${a}'`);
  }
  if (!placementId) throw usage("place override: <placement-id> is required");
  if (!newSlot) throw usage("place override: --new-slot <ISO datetime+TZ> is required");

  const newSlotCheck = ISODateTimeSchema.safeParse(newSlot);
  if (!newSlotCheck.success) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "--new-slot must be an ISO 8601 datetime with TZ" },
      cause: newSlotCheck.error.message,
      try: ["Use a value like 2026-04-27T11:00:00+09:00."],
      context: { value: newSlot },
    });
  }

  const home = defaultHomeDir();
  const yaml = await readPolicyYaml(home);
  if (!yaml) {
    throw new ScaffoldError({
      code: "DAY_NOT_INITIALIZED",
      summary: { en: "no policy/current.yaml yet" },
      cause: "place override needs the policy weights + working hours.",
      try: ["Run `scaffold-day policy preset apply balanced`."],
    });
  }
  const policy = compilePolicy(yaml);

  // Find the placement by scanning all day files (small N in v0.1).
  const dayStore = new FsDayStore(home);
  const months = await dayStore.listMonths();
  let foundPlacement: import("@scaffold/day-core").Placement | null = null;
  let foundDate: string | null = null;
  outer: for (const month of months) {
    const dates = await dayStore.listMonth(month);
    for (const d of dates) {
      const day = await dayStore.readDay(d);
      const match = day.placements.find((p) => p.id === placementId);
      if (match) {
        foundPlacement = match;
        foundDate = d;
        break outer;
      }
    }
  }
  if (!foundPlacement || !foundDate) {
    throw new ScaffoldError({
      code: "DAY_NOT_FOUND",
      summary: { en: `placement '${placementId}' not found` },
      cause: "No day file under <home>/days/ contains a placement with this id.",
      try: ["Run `scaffold-day day overview <YYYY-MM>` to inspect."],
      context: { placement_id: placementId },
    });
  }

  const newStartMs = Date.parse(newSlot);
  const newEndMs = newStartMs + foundPlacement.duration_min * 60_000;
  const newSlotEnd = new Date(newEndMs).toISOString();
  const newDate = newSlot.slice(0, 10);
  const tzOffset = offsetFromIso(newSlot);

  // Validate destination slot.
  const destDay = newDate === foundDate
    ? await dayStore.readDay(foundDate)
    : await dayStore.readDay(newDate);

  // For same-day move, exclude the placement we're moving from overlap checks.
  const existingPlacements = destDay.placements.filter((p) => p.id !== placementId);

  const hardCheck = evaluateHardRules(
    {
      start: newSlot,
      end: newSlotEnd,
      duration_min: foundPlacement.duration_min,
    },
    policy.hard_rules,
    {
      date: newDate,
      todoTags: foundPlacement.tags,
      events: destDay.events,
      placements: existingPlacements,
      tzOffset,
    },
  );
  if (!hardCheck.ok) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "--new-slot violates one or more hard rules" },
      cause: hardCheck.violations.map((v) => `  ${v.rule.kind}: ${v.reason}`).join("\n"),
      try: ["Pick a different new-slot, or relax the policy."],
      context: { violations: hardCheck.violations.length },
    });
  }
  for (const e of destDay.events) {
    const eStart = Date.parse(e.start);
    const eEnd = Date.parse(e.end);
    if (newStartMs < eEnd && eStart < newEndMs) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `--new-slot overlaps event '${e.title}'` },
        cause: `Event ${e.id} occupies ${e.start} - ${e.end}.`,
        try: ["Pick a non-overlapping slot."],
      });
    }
  }
  for (const p of existingPlacements) {
    const pStart = Date.parse(p.start);
    const pEnd = Date.parse(p.end);
    if (newStartMs < pEnd && pStart < newEndMs) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `--new-slot overlaps placement ${p.id}` },
        cause: `Existing placement covers ${p.start} - ${p.end}.`,
        try: ["Pick a non-overlapping slot."],
      });
    }
  }

  const overriddenAt = new Date().toISOString();
  const previous = { start: foundPlacement.start, end: foundPlacement.end };
  const updated = {
    ...foundPlacement,
    start: newSlot,
    end: newSlotEnd,
  };

  if (isDryRun()) {
    const writes: Array<{ path: string; op: "create" | "update" | "delete" }> = [
      { path: `logs/${newDate.slice(0, 7)}/placements.jsonl`, op: "update" },
    ];
    if (newDate === foundDate) {
      writes.push({ path: `days/${foundDate.slice(0, 7)}/${foundDate}.json`, op: "update" });
    } else {
      writes.push({ path: `days/${foundDate.slice(0, 7)}/${foundDate}.json`, op: "update" });
      writes.push({ path: `days/${newDate.slice(0, 7)}/${newDate}.json`, op: "update" });
    }
    emitDryRun(json, {
      command: "place override",
      writes,
      result: { placement: updated, previous, reason: reason ?? null },
    });
    return 0;
  }

  // Log first.
  await appendPlacementLog(home, {
    schema_version: "0.1.0",
    at: overriddenAt,
    action: "overridden",
    placement_id: placementId,
    todo_id: foundPlacement.todo_id,
    date: newDate,
    start: updated.start,
    end: updated.end,
    by,
    policy_hash: foundPlacement.policy_hash ?? null,
    reason: reason ?? null,
    previous,
  });

  // Apply: same-day → mutate in place; cross-day → remove from old, add to new.
  if (newDate === foundDate) {
    const day = await dayStore.readDay(foundDate);
    day.placements = day.placements.map((p) => (p.id === placementId ? updated : p));
    await dayStore.writeDay(day);
  } else {
    // Remove from old day.
    const oldDay = await dayStore.readDay(foundDate);
    oldDay.placements = oldDay.placements.filter((p) => p.id !== placementId);
    await dayStore.writeDay(oldDay);
    // Add to new day.
    await dayStore.addPlacement(newDate, updated);
  }

  if (json) {
    console.log(JSON.stringify({ placement: updated, previous, reason: reason ?? null }, null, 2));
    return 0;
  }
  console.log("scaffold-day place override");
  console.log(`  placement: ${updated.id}`);
  console.log(`  from:      ${previous.start} → ${previous.end}`);
  console.log(`  to:        ${updated.start} → ${updated.end}`);
  if (reason) console.log(`  reason:    ${reason}`);
  return 0;
}
