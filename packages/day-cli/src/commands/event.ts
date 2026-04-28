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

function placeholderSubcommand(name: string, slice: string): () => number {
  return () => {
    console.log(`scaffold-day event ${name}: not yet implemented (placeholder).`);
    console.log(`Run \`scaffold-day event --help\` to see the contract.`);
    console.log(`Tracking: ${slice}`);
    return 0;
  };
}

export const eventCommand: Command = {
  name: "event",
  summary: "manage fixed events on the calendar (add / update / delete)",
  help: {
    what: "Add, update, or delete a fixed event on the calendar. v0.1 ships `event add` (manual source) end-to-end; update / delete are scaffolded as placeholders pending the Google Calendar push slices.",
    when: "When recording a meeting, appointment, or any block of time the placement engine must work around.",
    cost: "Local file I/O on the relevant day file (`days/YYYY-MM/YYYY-MM-DD.json`). No network for `manual` source.",
    input: "add --title <text> --start <ISO datetime+TZ> --end <ISO datetime+TZ> [--all-day] [--location <text>] [--notes <text>] [--tag <#tag>]…\nupdate <id> ...     (placeholder, §S31b)\ndelete <id>         (placeholder, §S31c)",
    return: "Exit 0 on success. Prints the new event id and the day file it landed in. DAY_USAGE on missing flags. DAY_INVALID_INPUT on bad date/time/tag.",
    gotcha: "The day partition (`YYYY-MM-DD.json`) is derived from the date prefix of `--start`. Events that span midnight in the user's TZ land in the start day. Tracking SLICES.md §S9 (add) / §S31a-c (update + delete + Google Calendar push).",
  },
  run: async (args) => {
    const sub = args[0];
    if (sub === undefined || sub === "") {
      throw usage("event: missing subcommand. try `event add` (or --help for the full contract)");
    }
    if (sub === "add") return runEventAdd(args.slice(1));
    if (sub === "update") return placeholderSubcommand("update", "SLICES.md §S31b")();
    if (sub === "delete") return placeholderSubcommand("delete", "SLICES.md §S31c")();
    throw usage(`event: unknown subcommand '${sub}'`);
  },
};
