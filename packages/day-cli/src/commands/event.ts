import {
  type FixedEvent,
  FsDayStore,
  ISODateTimeSchema,
  ScaffoldError,
  TagSchema,
  defaultHomeDir,
  generateEntityId,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";

type ParsedAddFlags = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  tags: string[];
};

function usage(message: string, ko?: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message, ko: ko ?? message },
    cause: "See `scaffold-day event --help` for the full input contract.",
    try: ["Run `scaffold-day event --help`."],
  });
}

function takeValue(args: string[], i: number, flag: string): string {
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw usage(`event: ${flag} requires a value`);
  }
  return value;
}

function parseAddFlags(args: string[]): ParsedAddFlags {
  const out: ParsedAddFlags = {
    title: "",
    start: "",
    end: "",
    allDay: false,
    location: null,
    notes: null,
    tags: [],
  };
  let titleSeen = false;
  let startSeen = false;
  let endSeen = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    switch (a) {
      case "--title":
        out.title = takeValue(args, i, "--title");
        titleSeen = true;
        i++;
        break;
      case "--start":
        out.start = takeValue(args, i, "--start");
        startSeen = true;
        i++;
        break;
      case "--end":
        out.end = takeValue(args, i, "--end");
        endSeen = true;
        i++;
        break;
      case "--all-day":
        out.allDay = true;
        break;
      case "--location":
        out.location = takeValue(args, i, "--location");
        i++;
        break;
      case "--notes":
        out.notes = takeValue(args, i, "--notes");
        i++;
        break;
      case "--tag":
        out.tags.push(takeValue(args, i, "--tag"));
        i++;
        break;
      case "--json":
        // global flag — already handled by the dispatcher
        break;
      default:
        if (a.startsWith("--")) {
          throw usage(`event add: unknown option '${a}'`);
        }
        throw usage(`event add: unexpected argument '${a}'`);
    }
  }

  if (!titleSeen) throw usage("event add: --title is required");
  if (!startSeen) throw usage("event add: --start is required");
  if (!endSeen) throw usage("event add: --end is required");

  return out;
}

async function runEventAdd(args: string[]): Promise<number> {
  const flags = parseAddFlags(args);

  const startCheck = ISODateTimeSchema.safeParse(flags.start);
  if (!startCheck.success) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `--start is not a valid ISO 8601 datetime with TZ` },
      cause: startCheck.error.message,
      try: ["Use a value like 2026-04-26T10:00:00+09:00 (TZ required)."],
      context: { value: flags.start },
    });
  }
  const endCheck = ISODateTimeSchema.safeParse(flags.end);
  if (!endCheck.success) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `--end is not a valid ISO 8601 datetime with TZ` },
      cause: endCheck.error.message,
      try: ["Use a value like 2026-04-26T11:00:00+09:00 (TZ required)."],
      context: { value: flags.end },
    });
  }
  if (Date.parse(flags.end) <= Date.parse(flags.start)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "--end must be after --start" },
      cause: `start: ${flags.start}\nend:   ${flags.end}`,
      try: ["Pick an --end value strictly later than --start."],
      context: { start: flags.start, end: flags.end },
    });
  }

  const tags: string[] = [];
  for (const raw of flags.tags) {
    const tagCheck = TagSchema.safeParse(raw);
    if (!tagCheck.success) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `tag '${raw}' is not a valid Tag` },
        cause: tagCheck.error.message,
        try: ["Tags look like `#kebab-name` or `#deadline:2026-05-01`."],
        context: { value: raw },
      });
    }
    tags.push(tagCheck.data);
  }

  const home = defaultHomeDir();
  const store = new FsDayStore(home);

  const event: FixedEvent = {
    id: generateEntityId("event"),
    source: "manual",
    external_id: null,
    title: flags.title.trim(),
    start: flags.start,
    end: flags.end,
    all_day: flags.allDay,
    location: flags.location,
    notes: flags.notes,
    recurring: null,
    tags,
    synced_at: new Date().toISOString(),
  };

  const date = flags.start.slice(0, 10);

  if (isDryRun()) {
    emitDryRun(false, {
      command: "event add",
      writes: [
        { path: `days/${date.slice(0, 7)}/${date}.json`, op: "update" },
        { path: `days/${date.slice(0, 7)}/manifest.json`, op: "update" },
      ],
      result: event,
    });
    return 0;
  }

  const day = await store.addEvent(date, event);

  console.log(`scaffold-day event add`);
  console.log(`  id:    ${event.id}`);
  console.log(`  title: ${event.title}`);
  console.log(`  when:  ${event.start} → ${event.end}${event.all_day ? "  (all-day)" : ""}`);
  if (event.location) console.log(`  where: ${event.location}`);
  if (tags.length > 0) console.log(`  tags:  ${tags.join(" ")}`);
  console.log(`  file:  days/${date.slice(0, 7)}/${date}.json (${day.events.length} event${day.events.length === 1 ? "" : "s"} total)`);
  return 0;
}

async function findEvent(
  store: FsDayStore,
  id: string,
  hintDate?: string,
): Promise<{ event: FixedEvent; date: string } | null> {
  if (hintDate) {
    const day = await store.readDay(hintDate);
    const ev = day.events.find((e) => e.id === id);
    if (ev) return { event: ev, date: hintDate };
    return null;
  }
  // No hint — scan every month / day for the event id. v0.2 N is small.
  const months = await store.listMonths();
  for (const m of months) {
    const dates = await store.listMonth(m);
    for (const d of dates) {
      const day = await store.readDay(d);
      const ev = day.events.find((e) => e.id === id);
      if (ev) return { event: ev, date: d };
    }
  }
  return null;
}

type ParsedUpdateFlags = {
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string | null;
  notes?: string | null;
  tags?: string[];
  date?: string;
  json: boolean;
};

function parseUpdateFlags(args: string[]): ParsedUpdateFlags {
  const out: ParsedUpdateFlags = { json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    switch (a) {
      case "--title":
        out.title = takeValue(args, i, "--title");
        i++;
        break;
      case "--start":
        out.start = takeValue(args, i, "--start");
        i++;
        break;
      case "--end":
        out.end = takeValue(args, i, "--end");
        i++;
        break;
      case "--all-day":
        out.allDay = true;
        break;
      case "--no-all-day":
        out.allDay = false;
        break;
      case "--location":
        out.location = takeValue(args, i, "--location");
        i++;
        break;
      case "--clear-location":
        out.location = null;
        break;
      case "--notes":
        out.notes = takeValue(args, i, "--notes");
        i++;
        break;
      case "--clear-notes":
        out.notes = null;
        break;
      case "--tag": {
        const v = takeValue(args, i, "--tag");
        out.tags = out.tags ?? [];
        out.tags.push(v);
        i++;
        break;
      }
      case "--clear-tags":
        out.tags = [];
        break;
      case "--date":
        out.date = takeValue(args, i, "--date");
        i++;
        break;
      case "--json":
        out.json = true;
        break;
      default:
        if (a.startsWith("--")) throw usage(`event update: unknown option '${a}'`);
        throw usage(`event update: unexpected argument '${a}'`);
    }
  }
  return out;
}

async function runEventUpdate(args: string[]): Promise<number> {
  const id = args[0];
  if (!id || id.startsWith("--")) {
    throw usage("event update: <event-id> argument is required");
  }
  const flags = parseUpdateFlags(args.slice(1));

  const home = defaultHomeDir();
  const store = new FsDayStore(home);
  const found = await findEvent(store, id, flags.date);
  if (!found) {
    throw new ScaffoldError({
      code: "DAY_NOT_FOUND",
      summary: { en: `event '${id}' not found` },
      cause: flags.date
        ? `No event with this id exists on ${flags.date}.`
        : "No event with this id exists in any day file.",
      try: ["Run `scaffold-day day overview <YYYY-MM>` to inspect.", "Or pass --date <YYYY-MM-DD> if you know the day."],
      context: { id },
    });
  }

  // Build the proposed event after applying patches.
  const next: FixedEvent = { ...found.event };
  if (flags.title !== undefined) next.title = flags.title.trim();
  if (flags.start !== undefined) {
    const c = ISODateTimeSchema.safeParse(flags.start);
    if (!c.success) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `--start is not a valid ISO 8601 datetime with TZ` },
        cause: c.error.message,
        try: ["Use a value like 2026-04-26T10:00:00+09:00 (TZ required)."],
        context: { value: flags.start },
      });
    }
    next.start = flags.start;
  }
  if (flags.end !== undefined) {
    const c = ISODateTimeSchema.safeParse(flags.end);
    if (!c.success) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `--end is not a valid ISO 8601 datetime with TZ` },
        cause: c.error.message,
        try: ["Use a value like 2026-04-26T11:00:00+09:00 (TZ required)."],
        context: { value: flags.end },
      });
    }
    next.end = flags.end;
  }
  if (Date.parse(next.end) <= Date.parse(next.start)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "--end must be after --start" },
      cause: `start: ${next.start}\nend:   ${next.end}`,
      try: ["Pick an --end value strictly later than --start."],
      context: { start: next.start, end: next.end },
    });
  }
  if (flags.allDay !== undefined) next.all_day = flags.allDay;
  if (flags.location !== undefined) next.location = flags.location;
  if (flags.notes !== undefined) next.notes = flags.notes;
  if (flags.tags !== undefined) {
    const parsed: string[] = [];
    for (const raw of flags.tags) {
      const c = TagSchema.safeParse(raw);
      if (!c.success) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `tag '${raw}' is not a valid Tag` },
          cause: c.error.message,
          try: ["Tags look like `#kebab-name` or `#deadline:2026-05-01`."],
          context: { value: raw },
        });
      }
      parsed.push(c.data);
    }
    next.tags = parsed;
  }
  next.synced_at = new Date().toISOString();

  // The day file may need to change if --start crosses a day boundary.
  const newDate = next.start.slice(0, 10);

  if (isDryRun()) {
    const writes: Array<{ path: string; op: "create" | "update" | "delete" }> = [];
    writes.push({ path: `days/${found.date.slice(0, 7)}/${found.date}.json`, op: "update" });
    if (newDate !== found.date) {
      writes.push({ path: `days/${newDate.slice(0, 7)}/${newDate}.json`, op: "update" });
    }
    emitDryRun(flags.json, {
      command: "event update",
      writes,
      result: { event: next, previous_date: found.date, new_date: newDate },
    });
    return 0;
  }

  if (newDate === found.date) {
    const day = await store.readDay(found.date);
    day.events = day.events.map((e) => (e.id === id ? next : e));
    await store.writeDay(day);
  } else {
    const oldDay = await store.readDay(found.date);
    oldDay.events = oldDay.events.filter((e) => e.id !== id);
    await store.writeDay(oldDay);
    await store.addEvent(newDate, next);
  }

  if (flags.json) {
    console.log(JSON.stringify({ event: next, previous_date: found.date, new_date: newDate }, null, 2));
    return 0;
  }
  console.log("scaffold-day event update");
  console.log(`  id:    ${next.id}`);
  console.log(`  title: ${next.title}`);
  console.log(`  when:  ${next.start} → ${next.end}${next.all_day ? "  (all-day)" : ""}`);
  if (next.location) console.log(`  where: ${next.location}`);
  if (next.tags.length > 0) console.log(`  tags:  ${next.tags.join(" ")}`);
  if (newDate !== found.date) {
    console.log(`  moved: ${found.date} → ${newDate}`);
  }
  return 0;
}

async function runEventDelete(args: string[]): Promise<number> {
  const id = args[0];
  if (!id || id.startsWith("--")) {
    throw usage("event delete: <event-id> argument is required");
  }
  let date: string | undefined;
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--date") {
      date = takeValue(args, i, "--date");
      i++;
    } else if (a === "--json") {
      json = true;
    } else if (a.startsWith("--")) {
      throw usage(`event delete: unknown option '${a}'`);
    } else {
      throw usage(`event delete: unexpected argument '${a}'`);
    }
  }

  const home = defaultHomeDir();
  const store = new FsDayStore(home);
  const found = await findEvent(store, id, date);
  if (!found) {
    throw new ScaffoldError({
      code: "DAY_NOT_FOUND",
      summary: { en: `event '${id}' not found` },
      cause: date
        ? `No event with this id exists on ${date}.`
        : "No event with this id exists in any day file.",
      try: ["Run `scaffold-day day overview <YYYY-MM>` to inspect.", "Or pass --date <YYYY-MM-DD> if you know the day."],
      context: { id },
    });
  }

  if (isDryRun()) {
    emitDryRun(json, {
      command: "event delete",
      writes: [
        { path: `days/${found.date.slice(0, 7)}/${found.date}.json`, op: "update" },
      ],
      result: { id, date: found.date, title: found.event.title },
    });
    return 0;
  }

  const day = await store.readDay(found.date);
  day.events = day.events.filter((e) => e.id !== id);
  await store.writeDay(day);

  if (json) {
    console.log(JSON.stringify({ id, date: found.date, title: found.event.title }, null, 2));
    return 0;
  }
  console.log("scaffold-day event delete");
  console.log(`  id:    ${id}`);
  console.log(`  title: ${found.event.title}`);
  console.log(`  date:  ${found.date}`);
  return 0;
}

export const eventCommand: Command = {
  name: "event",
  summary: "manage fixed events on the calendar (add / update / delete)",
  help: {
    what: "Add, update, or delete a fixed event on the calendar. `add` creates a `manual`-source event; `update` patches any field (re-partitioning the day file when --start crosses days); `delete` removes by id.",
    when: "When recording a meeting, appointment, or any block of time the placement engine must work around.",
    cost: "Local file I/O on the relevant day file(s). No network for `manual` source. `update` / `delete` scan all day files when --date is omitted.",
    input: "add --title <text> --start <ISO datetime+TZ> --end <ISO datetime+TZ> [--all-day] [--location <text>] [--notes <text>] [--tag <#tag>]…\nupdate <id> [--title <t>] [--start <ISO>] [--end <ISO>] [--all-day | --no-all-day] [--location <t> | --clear-location] [--notes <t> | --clear-notes] [--tag <#t>… | --clear-tags] [--date <YYYY-MM-DD>] [--json]\ndelete <id> [--date <YYYY-MM-DD>] [--json]",
    return: "Exit 0 on success. DAY_USAGE on missing flags. DAY_INVALID_INPUT on bad date/time/tag. DAY_NOT_FOUND when the event id is unknown.",
    gotcha: "The day partition (`YYYY-MM-DD.json`) is derived from `--start`. `update` re-partitions the file when --start moves the event across midnight in its TZ. Tracking SLICES.md §S9 (add) / §S80 (update + delete).",
  },
  run: async (args) => {
    const sub = args[0];
    if (sub === undefined || sub === "") {
      throw usage("event: missing subcommand. try `event add` (or --help for the full contract)");
    }
    if (sub === "add") return runEventAdd(args.slice(1));
    if (sub === "update") return runEventUpdate(args.slice(1));
    if (sub === "delete") return runEventDelete(args.slice(1));
    throw usage(`event: unknown subcommand '${sub}'`);
  },
};
