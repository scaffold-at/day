import { encodeTime } from "ulid";
import { z } from "zod";

/**
 * EntityId catalog (PRD §9.2, SLICES §S5).
 *
 * Format: `<prefix>_<14 chars [a-z0-9]>` where the 14 chars are
 *   - 10 chars: ULID Crockford-base32 timestamp, lower-cased
 *   -  4 chars: random [a-z0-9]
 *
 * Total id length is `prefix.length + 1 + 14`.
 *
 * The schema deliberately does NOT brand the prefix into the type so a
 * Zod parse on persisted JSON works without knowing the kind ahead of
 * time. Per-kind narrowing is available via `entityIdSchemaOf(kind)`.
 */

export const ENTITY_PREFIXES = {
  todo: "todo",
  event: "evt",
  placement: "plc",
  conflict: "cfl",
  adapter: "adap",
  draft: "dft",
} as const;

export type EntityKind = keyof typeof ENTITY_PREFIXES;
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityKind];

export const ENTITY_ID_REGEX = /^[a-z]+_[a-z0-9]{14}$/;

export const KNOWN_ENTITY_PREFIXES = Object.freeze(
  Object.values(ENTITY_PREFIXES) as EntityPrefix[],
);

const KNOWN_ENTITY_ID_REGEX = new RegExp(
  `^(${KNOWN_ENTITY_PREFIXES.join("|")})_[a-z0-9]{14}$`,
);

export const EntityIdSchema = z
  .string()
  .regex(ENTITY_ID_REGEX, "EntityId must match ^[a-z]+_[a-z0-9]{14}$");

export const KnownEntityIdSchema = z
  .string()
  .regex(
    KNOWN_ENTITY_ID_REGEX,
    `EntityId must use a known prefix: ${KNOWN_ENTITY_PREFIXES.join(", ")}`,
  );

export type EntityId = z.infer<typeof EntityIdSchema>;

export function entityIdSchemaOf<K extends EntityKind>(kind: K) {
  const prefix = ENTITY_PREFIXES[kind];
  const re = new RegExp(`^${prefix}_[a-z0-9]{14}$`);
  return z.string().regex(re, `expected ${prefix}_<14 [a-z0-9]>`);
}

const RAND_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomTail(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += RAND_CHARS[Math.floor(Math.random() * RAND_CHARS.length)];
  }
  return out;
}

/**
 * Generate a new EntityId for a given kind. Uses ULID's Crockford-base32
 * timestamp encoding (lower-cased so the regex stays `[a-z0-9]`) plus
 * 4 random characters.
 */
export function generateEntityId(kind: EntityKind, now: number = Date.now()): string {
  const timestamp = encodeTime(now, 10).toLowerCase();
  return `${ENTITY_PREFIXES[kind]}_${timestamp}${randomTail(4)}`;
}
