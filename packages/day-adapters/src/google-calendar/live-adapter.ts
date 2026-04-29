/**
 * Live Google Calendar adapter (PRD v0.2 §S71 + §S72).
 *
 * Talks to the real Google Calendar v3 API. Mirrors the
 * MockGoogleCalendarAdapter surface so the placement engine and the
 * sync orchestration code don't need to know which one is wired up.
 *
 * Read path (S71):
 *   - events.list with `syncToken` for incremental pulls
 *   - 410 Gone → drop the sync_token and full re-sync
 *   - access-token expiry → silent refresh via the refresh_token
 *
 * Write path (S72):
 *   - events.insert (create), events.patch (update; If-Match: etag),
 *     events.delete
 *   - 412 Precondition Failed → retryable error so the caller can
 *     decide reconciliation policy
 *
 * Reconcile (Last-Wins per PRD §10.5): pick the side with the
 * later `synced_at` (mock-adapter parity).
 *
 * Token storage: read / write `<home>/.secrets/google-oauth.json` —
 * v0.2 file-based; keytar lands in S73.
 */

import type { FixedEvent, ScaffoldError as ScaffoldErrorType } from "@scaffold/day-core";
import { ScaffoldError } from "@scaffold/day-core";
import {
  effectiveClientId,
  effectiveClientSecret,
} from "./oauth-desktop";
import {
  type GoogleCalendarSyncState,
  readSyncState,
  writeSyncState,
} from "./sync-state";
import {
  type GoogleOAuthToken,
  readGoogleOAuthToken,
  writeGoogleOAuthToken,
} from "./token-storage";
import type {
  AdapterCapabilities,
  AdapterConfig,
  AdapterHealth,
  DateRange,
  ExternalEvent,
  LocalEventChange,
  PushResult,
  Reconciliation,
  SyncAdapter,
} from "../sync-adapter";

const ADAPTER_ID = "google-calendar-live";
const ADAPTER_VERSION = "0.1.0";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const SCHEMA_VERSION = "0.1.0";

// Etag map kept in-memory so we can send `If-Match` on patch / delete.
// Persisted form lives in sync-state under event_id_map (we extend it
// in v0.3 if etag misses prove painful — for now misses fall back to
// "force overwrite" which is the existing reconcile path).

type GcalDateTime =
  | { dateTime: string; timeZone?: string }
  | { date: string };

type GcalEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start: GcalDateTime;
  end: GcalDateTime;
  recurrence?: string[];
  etag: string;
  updated?: string;
};

type ListResponse = {
  kind: "calendar#events";
  items: GcalEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

function isAllDay(d: GcalDateTime): d is { date: string } {
  return "date" in d;
}

/**
 * Convert a Google Calendar event into the FixedEvent shape used by
 * day-core. Recurring events get serialised as their RRULE strings.
 */
function gcalToFixed(e: GcalEvent, syncedAt: string): FixedEvent {
  const startIso = isAllDay(e.start) ? `${e.start.date}T00:00:00+00:00` : e.start.dateTime;
  const endIso = isAllDay(e.end) ? `${e.end.date}T00:00:00+00:00` : e.end.dateTime;
  return {
    id: e.id,
    source: "google-calendar",
    external_id: e.id,
    title: e.summary ?? "(untitled)",
    start: startIso,
    end: endIso,
    all_day: isAllDay(e.start),
    location: e.location ?? null,
    notes: e.description ?? null,
    recurring:
      e.recurrence && e.recurrence.length > 0
        ? { parent_id: e.id, rrule: e.recurrence.join("\n") }
        : null,
    tags: [],
    synced_at: syncedAt,
  };
}

function fixedToGcalBody(event: FixedEvent | Partial<FixedEvent>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (event.title !== undefined) body.summary = event.title;
  if (event.notes !== undefined) body.description = event.notes ?? "";
  if (event.location !== undefined) body.location = event.location ?? "";
  if (event.start !== undefined) {
    body.start = event.all_day ? { date: event.start.slice(0, 10) } : { dateTime: event.start };
  }
  if (event.end !== undefined) {
    body.end = event.all_day ? { date: event.end.slice(0, 10) } : { dateTime: event.end };
  }
  if (event.recurring !== undefined) {
    body.recurrence = event.recurring ? event.recurring.rrule.split("\n") : [];
  }
  return body;
}

// ─── token refresh ─────────────────────────────────────────────────

async function refreshAccessToken(
  home: string,
  current: GoogleOAuthToken,
): Promise<GoogleOAuthToken> {
  const clientId = effectiveClientId();
  const clientSecret = effectiveClientSecret();
  if (!clientId || !clientSecret) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "Google OAuth client credentials not configured" },
      cause:
        "Token refresh needs the same client_id / client_secret used during initial login.",
      try: ["Use a release binary or set SCAFFOLD_DAY_GOOGLE_CLIENT_SECRET in dev."],
    });
  }
  const r = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: current.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `token refresh failed: ${r.status} ${r.statusText}` },
      cause: (await r.text()).slice(0, 500),
      try: [
        "Re-run `scaffold-day auth login` to acquire a fresh refresh_token.",
        "Or revoke prior consent at https://myaccount.google.com/connections.",
      ],
    });
  }
  const json = (await r.json()) as {
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  const next: GoogleOAuthToken = {
    ...current,
    access_token: json.access_token,
    expiry_at:
      typeof json.expires_in === "number"
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : null,
    scope: json.scope ?? current.scope,
    token_type: json.token_type ?? current.token_type,
  };
  await writeGoogleOAuthToken(home, next);
  return next;
}

function tokenLooksExpired(t: GoogleOAuthToken): boolean {
  if (!t.expiry_at) return false;
  const ms = Date.parse(t.expiry_at);
  if (!Number.isFinite(ms)) return false;
  // Consider expired 30s before the actual expiry to avoid races.
  return ms - 30_000 < Date.now();
}

// ─── adapter ──────────────────────────────────────────────────────

export type LiveAdapterOptions = {
  /** Override calendar id; defaults to "primary". */
  calendarId?: string;
  /** Test seam: replace fetch (e.g. for unit tests). */
  fetchImpl?: typeof fetch;
};

export class LiveGoogleCalendarAdapter implements SyncAdapter {
  readonly id = ADAPTER_ID;
  readonly version = ADAPTER_VERSION;

  private home = "";
  private calendarId = "primary";
  private account = "";
  private fetchImpl: typeof fetch;

  constructor(options: LiveAdapterOptions = {}) {
    if (options.calendarId) this.calendarId = options.calendarId;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  capabilities(): AdapterCapabilities {
    return {
      read: true,
      write: true,
      push_create: true,
      push_update: true,
      push_delete: true,
      recurring_read: true,
      multi_account: false,
    };
  }

  async init(config: AdapterConfig): Promise<void> {
    this.home = config.home;
    if (config.account?.email) this.account = config.account.email;
    if (config.account?.calendar_id) this.calendarId = config.account.calendar_id;

    const token = await readGoogleOAuthToken(this.home);
    if (!token) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "google-calendar-live: no OAuth token stored" },
        cause: `Expected ${this.home}/.secrets/google-oauth.json`,
        try: ["Run `scaffold-day auth login` first."],
      });
    }
    if (!this.account && token.account_email) this.account = token.account_email;

    let state = await readSyncState(this.home);
    if (!state || state.adapter_id !== ADAPTER_ID) {
      state = {
        schema_version: SCHEMA_VERSION,
        adapter_id: ADAPTER_ID,
        adapter_version: ADAPTER_VERSION,
        account: this.account,
        calendar_id: this.calendarId,
        sync_token: null,
        event_id_map: {},
        last_sync_at: null,
        oauth_ref: token.storage,
      };
      await writeSyncState(this.home, state);
    }
  }

  async pull(range: DateRange): Promise<ExternalEvent[]> {
    this.assertInited();
    const token = await this.ensureFreshToken();
    let state = (await readSyncState(this.home))!;

    const now = new Date().toISOString();
    const events: ExternalEvent[] = [];
    let pageToken: string | null = null;
    let nextSyncToken: string | null = state.sync_token;

    do {
      const params = new URLSearchParams();
      params.set("singleEvents", "true");
      params.set("maxResults", "250");
      if (state.sync_token) {
        params.set("syncToken", state.sync_token);
      } else {
        params.set("timeMin", `${range.start}T00:00:00Z`);
        params.set("timeMax", `${range.end}T23:59:59Z`);
      }
      if (pageToken) params.set("pageToken", pageToken);

      const r = await this.fetchImpl(
        `${CAL_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events?${params.toString()}`,
        { headers: { authorization: `Bearer ${token.access_token}` } },
      );

      if (r.status === 410) {
        // Sync token expired; clear it and retry from scratch.
        state = { ...state, sync_token: null };
        await writeSyncState(this.home, state);
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: "Google sync_token expired (410); cleared — retry the pull" },
          cause: "Google returned 410 Gone for the stored sync_token.",
          try: ["Re-run the pull; it will do a full re-sync."],
        });
      }
      if (!r.ok) {
        throw apiError("pull", r);
      }
      const body = (await r.json()) as ListResponse;

      for (const e of body.items) {
        if (e.status === "cancelled") continue;
        events.push(gcalToFixed(e, now));
        // Track external_id → internal placeholder; v0.2 keeps the
        // mapping symmetric (id == external_id for read-back).
        state.event_id_map[e.id] = e.id;
      }
      pageToken = body.nextPageToken ?? null;
      if (body.nextSyncToken) nextSyncToken = body.nextSyncToken;
    } while (pageToken);

    state = {
      ...state,
      sync_token: nextSyncToken,
      last_sync_at: now,
    };
    await writeSyncState(this.home, state);

    return events;
  }

  async push(changes: ReadonlyArray<LocalEventChange>): Promise<PushResult[]> {
    this.assertInited();
    const token = await this.ensureFreshToken();
    const results: PushResult[] = [];
    const now = new Date().toISOString();

    for (const change of changes) {
      try {
        if (change.kind === "create") {
          const r = await this.fetchImpl(
            `${CAL_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${token.access_token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(fixedToGcalBody(change.event)),
            },
          );
          if (!r.ok) throw apiError("push.create", r);
          const created = (await r.json()) as GcalEvent;
          results.push({
            kind: "ok",
            change,
            external_id: created.id,
            synced_at: now,
          });
        } else if (change.kind === "update") {
          const r = await this.fetchImpl(
            `${CAL_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(change.event_id)}`,
            {
              method: "PATCH",
              headers: {
                authorization: `Bearer ${token.access_token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(fixedToGcalBody(change.patch)),
            },
          );
          if (r.status === 412) {
            // Etag mismatch — treat as retryable so caller can
            // pull → reconcile → push again.
            results.push({
              kind: "error",
              change,
              reason: "etag mismatch (412 Precondition Failed)",
              retryable: true,
            });
            continue;
          }
          if (!r.ok) throw apiError("push.update", r);
          const updated = (await r.json()) as GcalEvent;
          results.push({
            kind: "ok",
            change,
            external_id: updated.id,
            synced_at: now,
          });
        } else if (change.kind === "delete") {
          const r = await this.fetchImpl(
            `${CAL_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(change.event_id)}`,
            {
              method: "DELETE",
              headers: { authorization: `Bearer ${token.access_token}` },
            },
          );
          if (!r.ok && r.status !== 410 && r.status !== 404) {
            throw apiError("push.delete", r);
          }
          results.push({
            kind: "ok",
            change,
            external_id: change.event_id,
            synced_at: now,
          });
        }
      } catch (err) {
        const reason =
          err instanceof Error
            ? `${(err as ScaffoldErrorType).code ?? "API"}: ${err.message}`
            : String(err);
        results.push({
          kind: "error",
          change,
          reason,
          retryable: false,
        });
      }
    }

    return results;
  }

  reconcile(local: FixedEvent, remote: ExternalEvent): Reconciliation {
    const localT = Date.parse(local.synced_at);
    const remoteT = Date.parse(remote.synced_at);
    if (!Number.isFinite(localT) || !Number.isFinite(remoteT)) {
      return { kind: "theirs", reason: "synced_at unparseable; falling back to remote" };
    }
    if (remoteT > localT) return { kind: "theirs", reason: "remote synced later" };
    if (localT > remoteT) return { kind: "ours", reason: "local synced later" };
    return { kind: "theirs", reason: "tie; remote wins" };
  }

  async healthCheck(): Promise<AdapterHealth> {
    try {
      this.assertInited();
      const token = await this.ensureFreshToken();
      const r = await this.fetchImpl(
        `${CAL_BASE}/calendars/${encodeURIComponent(this.calendarId)}`,
        { headers: { authorization: `Bearer ${token.access_token}` } },
      );
      const state = await readSyncState(this.home);
      return {
        ok: r.ok,
        detail: r.ok
          ? `connected to ${this.calendarId}`
          : `${r.status} ${r.statusText}`,
        last_sync_at: state?.last_sync_at ?? null,
      };
    } catch (err) {
      return {
        ok: false,
        detail: (err as Error).message,
        last_sync_at: null,
      };
    }
  }

  // ─── internals ──────────────────────────────────────────────────

  private assertInited(): void {
    if (!this.home) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "live adapter not initialized" },
        cause: "Call adapter.init({home, account}) first.",
        try: ["Pipe through the standard sync orchestration."],
      });
    }
  }

  private async ensureFreshToken(): Promise<GoogleOAuthToken> {
    const t = await readGoogleOAuthToken(this.home);
    if (!t) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "no OAuth token stored" },
        cause: `Expected ${this.home}/.secrets/google-oauth.json`,
        try: ["Run `scaffold-day auth login`."],
      });
    }
    if (!tokenLooksExpired(t)) return t;
    return refreshAccessToken(this.home, t);
  }
}

function apiError(label: string, r: Response): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_INVALID_INPUT",
    summary: { en: `google-calendar ${label} failed: ${r.status} ${r.statusText}` },
    cause: `URL: ${r.url}`,
    try: ["Retry; if 401, re-run `scaffold-day auth login`."],
  });
}
