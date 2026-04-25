/**
 * DAY_* error code catalog (PRD §11.1, SLICES §S3 seed).
 *
 * Each entry pairs a code with its default exit code (BSD sysexits-ish),
 * a human description, and an optional canonical docs anchor. Specific
 * codes are added as their owning slices land — this seed lists what
 * the surface needs day-1 plus a handful of forward-declared codes that
 * later slices will throw.
 */

export type DayCodeMetadata = {
  /** Short description of when this code is raised. */
  readonly description: string;
  /** Default process exit code for this class of error. */
  readonly defaultExitCode: number;
  /** Optional default docs URL; instances may override. */
  readonly defaultDocs?: string;
};

export const DAY_CODE_CATALOG = {
  DAY_USAGE: {
    description: "Invalid CLI usage (unknown command, bad flag combination).",
    defaultExitCode: 2,
    defaultDocs: "https://scaffold.at/day/docs/cli",
  },
  DAY_INVALID_INPUT: {
    description: "Validation failure on user-supplied data.",
    defaultExitCode: 65,
  },
  DAY_NOT_FOUND: {
    description: "Referenced entity (todo, event, day, placement) does not exist.",
    defaultExitCode: 66,
  },
  DAY_NOT_INITIALIZED: {
    description: "~/scaffold-day/ has not been created yet — run `scaffold-day init`.",
    defaultExitCode: 78,
    defaultDocs: "https://scaffold.at/day/docs/getting-started",
  },
  DAY_LOCK_HELD: {
    description: "Another scaffold-day process holds the advisory lock.",
    defaultExitCode: 73,
  },
  DAY_SCHEMA_FUTURE_VERSION: {
    description: "Local data was written by a newer scaffold-day; refusing to read.",
    defaultExitCode: 78,
    defaultDocs: "https://scaffold.at/day/docs/troubleshooting#future-schema",
  },
  DAY_PROVIDER_TIMEOUT: {
    description: "AI provider call exceeded the configured timeout.",
    defaultExitCode: 75,
  },
  DAY_PROVIDER_AUTH_EXPIRED: {
    description: "AI provider authentication has expired or is missing.",
    defaultExitCode: 77,
  },
  DAY_OAUTH_NO_REFRESH: {
    description: "Google Calendar refresh token is missing or revoked.",
    defaultExitCode: 77,
    defaultDocs: "https://scaffold.at/day/docs/troubleshooting#oauth",
  },
  DAY_INTERNAL: {
    description: "Unexpected internal error — please file a bug.",
    defaultExitCode: 70,
    defaultDocs: "https://github.com/scaffold-at/day/issues/new",
  },
} as const satisfies Record<string, DayCodeMetadata>;

export type DayCode = keyof typeof DAY_CODE_CATALOG;

export function getCodeMetadata(code: DayCode): DayCodeMetadata {
  return DAY_CODE_CATALOG[code];
}

export function isDayCode(value: string): value is DayCode {
  return value in DAY_CODE_CATALOG;
}
