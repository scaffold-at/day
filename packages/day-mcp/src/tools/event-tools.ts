import {
  defaultHomeDir,
  entityIdSchemaOf,
  type FixedEvent,
  FsDayStore,
  generateEntityId,
  ISODateTimeSchema,
  ScaffoldError,
  TagSchema,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

const EventIdSchema = entityIdSchemaOf("event");

// ─── create_event (manual source) ──────────────────────────────────

const CreateInput = z
  .object({
    title: z.string().trim().min(1).max(280),
    start: ISODateTimeSchema,
    end: ISODateTimeSchema,
    all_day: z.boolean().optional(),
    location: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    tags: z.array(TagSchema).max(32).optional(),
  })
  .strict();
type CreateIn = z.infer<typeof CreateInput>;

export const createEventTool: Tool<CreateIn, unknown> = {
  name: "create_event",
  description:
    "Create a manual FixedEvent on the day file derived from `start`'s date prefix. v0.1 manual source only — Google Calendar push lands in §S31a.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1, maxLength: 280 },
      start: { type: "string", description: "ISO 8601 datetime with TZ" },
      end: { type: "string", description: "ISO 8601 datetime with TZ" },
      all_day: { type: "boolean" },
      location: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["title", "start", "end"],
    additionalProperties: false,
  },
  parser: CreateInput,
  handler: async (input: CreateIn) => {
    if (Date.parse(input.end) <= Date.parse(input.start)) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: "end must be after start" },
        cause: `start: ${input.start}\nend:   ${input.end}`,
        try: ["Pass an end strictly after start."],
      });
    }
    const event: FixedEvent = {
      id: generateEntityId("event"),
      source: "manual",
      external_id: null,
      title: input.title.trim(),
      start: input.start,
      end: input.end,
      all_day: input.all_day ?? false,
      location: input.location ?? null,
      notes: input.notes ?? null,
      recurring: null,
      tags: input.tags ? [...input.tags] : [],
      synced_at: new Date().toISOString(),
    };
    const date = input.start.slice(0, 10);
    const store = new FsDayStore(defaultHomeDir());
    await store.addEvent(date, event);
    return event;
  },
};

// ─── update_event (file-level only) ────────────────────────────────

const UpdateInput = z
  .object({
    event_id: EventIdSchema,
    title: z.string().trim().min(1).max(280).optional(),
    start: ISODateTimeSchema.optional(),
    end: ISODateTimeSchema.optional(),
    all_day: z.boolean().optional(),
    location: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    tags: z.array(TagSchema).max(32).optional(),
  })
  .strict();
type UpdateIn = z.infer<typeof UpdateInput>;

async function findEvent(
  home: string,
  eventId: string,
): Promise<{ event: FixedEvent; date: string } | null> {
  const store = new FsDayStore(home);
  const months = await store.listMonths();
  for (const m of months) {
    const dates = await store.listMonth(m);
    for (const d of dates) {
      const day = await store.readDay(d);
      const ev = day.events.find((e) => e.id === eventId);
      if (ev) return { event: ev, date: d };
    }
  }
  return null;
}

export const updateEventTool: Tool<UpdateIn, unknown> = {
  name: "update_event",
  description:
    "Update fields on a manual FixedEvent in the day file (file-level only). Google Calendar push for synced events arrives in §S31b.",
  inputSchema: {
    type: "object",
    properties: {
      event_id: { type: "string", pattern: "^evt_[a-z0-9]{14}$" },
      title: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      all_day: { type: "boolean" },
      location: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["event_id"],
    additionalProperties: false,
  },
  parser: UpdateInput,
  handler: async (input: UpdateIn) => {
    const home = defaultHomeDir();
    const found = await findEvent(home, input.event_id);
    if (!found) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: `event '${input.event_id}' not found` },
        cause: "No day file under <home>/days/ contains an event with this id.",
        try: ["Call get_days_range or get_month_overview to inspect."],
        context: { event_id: input.event_id },
      });
    }
    const updated: FixedEvent = {
      ...found.event,
      title: input.title?.trim() ?? found.event.title,
      start: input.start ?? found.event.start,
      end: input.end ?? found.event.end,
      all_day: input.all_day ?? found.event.all_day,
      location:
        input.location !== undefined ? input.location : found.event.location,
      notes: input.notes !== undefined ? input.notes : found.event.notes,
      tags: input.tags ? [...input.tags] : found.event.tags,
      synced_at: new Date().toISOString(),
    };
    if (Date.parse(updated.end) <= Date.parse(updated.start)) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: "end must be after start" },
        cause: `start: ${updated.start}\nend:   ${updated.end}`,
        try: ["Pass values that produce end > start."],
      });
    }

    const store = new FsDayStore(home);
    const day = await store.readDay(found.date);
    day.events = day.events.map((e) => (e.id === input.event_id ? updated : e));
    await store.writeDay(day);
    return updated;
  },
};

// ─── delete_event ──────────────────────────────────────────────────

const DeleteInput = z.object({ event_id: EventIdSchema }).strict();
type DeleteIn = z.infer<typeof DeleteInput>;

export const deleteEventTool: Tool<DeleteIn, unknown> = {
  name: "delete_event",
  description:
    "Remove a manual FixedEvent from its day file. Google Calendar deletion lands in §S31c.",
  inputSchema: {
    type: "object",
    properties: { event_id: { type: "string", pattern: "^evt_[a-z0-9]{14}$" } },
    required: ["event_id"],
    additionalProperties: false,
  },
  parser: DeleteInput,
  handler: async (input: DeleteIn) => {
    const home = defaultHomeDir();
    const found = await findEvent(home, input.event_id);
    if (!found) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: `event '${input.event_id}' not found` },
        cause: "No day file under <home>/days/ contains an event with this id.",
        try: ["Call get_days_range or get_month_overview to inspect."],
      });
    }
    const store = new FsDayStore(home);
    const day = await store.readDay(found.date);
    day.events = day.events.filter((e) => e.id !== input.event_id);
    await store.writeDay(day);
    return { deleted: input.event_id, date: found.date };
  },
};
