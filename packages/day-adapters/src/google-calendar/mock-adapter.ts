import {
  type FixedEvent,
  generateEntityId,
  ScaffoldError,
} from "@scaffold/day-core";
import {
  type AdapterCapabilities,
  type AdapterConfig,
  type AdapterHealth,
  type DateRange,
  type ExternalEvent,
  type LocalEventChange,
  type PushResult,
  type Reconciliation,
  type SyncAdapter,
} from "../sync-adapter";
import {
  readSyncState,
  writeSyncState,
  type GoogleCalendarSyncState,
} from "./sync-state";

/**
 * Fixture-driven Google Calendar adapter (PRD §11.5 / SLICES §S30-§S31).
 *
 * v0.1 ships ONLY the mock adapter; a real adapter that talks to the
 * Google Calendar API lives behind the `B mode` test path that
 * requires user-provided OAuth credentials (see
 * memory:project_test_strategy + project_hosting). This mock takes
 * a `pullFixture` array on construction and returns it from `pull()`,
 * walking the sync_token forward each call so incremental sync
 * tests behave like a real server.
 *
 * `push()` records every change in `pushedChanges` and returns a
 * synthetic external_id. `reconcile()` is a stub that defers to
 * Last-Wins (PRD §10.4 v0.2 will replace this).
 */
export type MockAdapterFixture = {
  /** Events returned from `pull()`. The adapter pages through them
   * across calls when `incremental` is true. */
  events: ExternalEvent[];
  /** When true, simulate the Google Cal API's incremental sync_token
   * behavior — the second pull only returns events created/modified
   * since the previous sync_token. v0.1 is a coarse boolean: true →
   * empty on the second call (no changes); false → always full. */
  incremental?: boolean;
  /** Inject a 410 Gone after `failAfterPulls` calls so §S30b's full-
   * resync recovery path can be exercised. */
  failAfterPulls?: number;
  /** Per-change response override for `push()`. Keyed by external id
   * the change targets (or sequential index). */
  pushOverrides?: Array<PushResult>;
};

export class MockGoogleCalendarAdapter implements SyncAdapter {
  readonly id = "google-calendar-mock";
  readonly version = "0.1.0";
  private readonly fixture: MockAdapterFixture;
  private home: string | null = null;
  private account: string | null = null;
  private calendarId: string | null = null;
  private pullCount = 0;

  /** Public test surface — every push call appends to this. */
  readonly pushedChanges: LocalEventChange[] = [];

  constructor(fixture: MockAdapterFixture) {
    this.fixture = fixture;
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
    this.account = config.account?.email ?? "mock@example.com";
    this.calendarId = config.account?.calendar_id ?? "primary";

    let state = await readSyncState(this.home);
    if (!state) {
      const fresh: GoogleCalendarSyncState = {
        schema_version: "0.1.0",
        adapter_id: this.id,
        adapter_version: this.version,
        account: this.account,
        calendar_id: this.calendarId,
        sync_token: null,
        event_id_map: {},
        last_sync_at: null,
        oauth_ref: "file",
      };
      state = fresh;
      await writeSyncState(this.home, state);
    }
  }

  async pull(_range: DateRange): Promise<ExternalEvent[]> {
    this.assertInited();
    this.pullCount++;

    if (
      this.fixture.failAfterPulls !== undefined &&
      this.pullCount > this.fixture.failAfterPulls
    ) {
      // Simulate Google's "410 Gone — sync_token expired" by clearing
      // the stored sync_token and asking the caller to re-pull.
      const state = await this.requireState();
      state.sync_token = null;
      await writeSyncState(this.home!, state);
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: "google-calendar-mock: sync_token expired (HTTP 410)" },
        cause: "Mock fixture flagged failAfterPulls; full resync required.",
        try: ["Re-run pull() — the next call returns the full dataset."],
        context: { account: this.account, calendar_id: this.calendarId },
      });
    }

    const state = await this.requireState();
    const isIncremental =
      this.fixture.incremental === true && state.sync_token !== null;
    const events = isIncremental ? [] : [...this.fixture.events];

    state.sync_token = `mock-token-${this.pullCount}`;
    state.last_sync_at = new Date().toISOString();
    // Update event_id_map for fresh events.
    for (const ev of events) {
      if (ev.external_id) {
        state.event_id_map[ev.id] = ev.external_id;
      }
    }
    await writeSyncState(this.home!, state);
    return events;
  }

  async push(changes: ReadonlyArray<LocalEventChange>): Promise<PushResult[]> {
    this.assertInited();
    const results: PushResult[] = [];
    for (const [i, change] of changes.entries()) {
      this.pushedChanges.push(change);
      const override = this.fixture.pushOverrides?.[i];
      if (override) {
        results.push(override);
        continue;
      }
      results.push({
        kind: "ok",
        change,
        external_id:
          change.kind === "create"
            ? generateEntityId("event")
            : (change.kind === "update" || change.kind === "delete")
              ? change.event_id
              : "unknown",
        synced_at: new Date().toISOString(),
      });
    }
    return results;
  }

  reconcile(local: FixedEvent, remote: ExternalEvent): Reconciliation {
    // Last-Wins by `synced_at` (PRD §10.4): newer wins.
    const localMs = Date.parse(local.synced_at);
    const remoteMs = Date.parse(remote.synced_at);
    if (remoteMs >= localMs) {
      return { kind: "theirs", reason: `remote synced_at ${remote.synced_at} ≥ local ${local.synced_at}` };
    }
    return { kind: "ours", reason: `local synced_at ${local.synced_at} > remote ${remote.synced_at}` };
  }

  async healthCheck(): Promise<AdapterHealth> {
    if (!this.home) {
      return { ok: false, detail: "adapter not initialized" };
    }
    const state = await readSyncState(this.home);
    return {
      ok: true,
      detail: `mock adapter healthy (account ${this.account}, calendar ${this.calendarId})`,
      last_sync_at: state?.last_sync_at ?? null,
    };
  }

  private assertInited(): void {
    if (!this.home || !this.account || !this.calendarId) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "google-calendar-mock not initialized" },
        cause: "Call init() before pull() / push().",
        try: ["adapter.init({home, account: {...}})"],
      });
    }
  }

  private async requireState(): Promise<GoogleCalendarSyncState> {
    const state = await readSyncState(this.home!);
    if (!state) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "sync state missing" },
        cause: "Sync state file was removed after init().",
        try: ["Re-run init()."],
      });
    }
    return state;
  }
}
