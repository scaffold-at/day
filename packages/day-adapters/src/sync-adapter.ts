import type { FixedEvent } from "@scaffold/day-core";

/**
 * External event from a calendar source — uses the same shape as
 * `FixedEvent` in day-core but lives in the adapter package so
 * adapter authors don't pull in the full domain core.
 *
 * v0.1 simply re-exports `FixedEvent`. v0.2 may diverge when
 * `local_overlay` lands.
 */
export type ExternalEvent = FixedEvent;

export type DateRange = {
  start: string;
  end: string;
};

export type LocalEventChange =
  | { kind: "create"; event: FixedEvent }
  | { kind: "update"; event_id: string; patch: Partial<FixedEvent> }
  | { kind: "delete"; event_id: string };

export type PushResult =
  | {
      kind: "ok";
      change: LocalEventChange;
      external_id: string;
      synced_at: string;
    }
  | {
      kind: "error";
      change: LocalEventChange;
      reason: string;
      retryable: boolean;
    };

export type Reconciliation =
  | { kind: "ours"; reason: string }
  | { kind: "theirs"; reason: string }
  | { kind: "both"; merged: FixedEvent };

export type AdapterHealth = {
  ok: boolean;
  detail: string;
  last_sync_at?: string | null;
};

export type AdapterConfig = {
  /** scaffold-day home directory. */
  home: string;
  /** Adapter-specific config (account email, calendar id, etc.). */
  account?: Record<string, string | undefined>;
};

/**
 * Capability flags a real adapter declares. Used by §S35 doctor and
 * §v0.2 multi-adapter resolution. v0.1 only ships google-calendar
 * single-instance, so this is mostly forward-looking.
 */
export type AdapterCapabilities = {
  read: boolean;
  write: boolean;
  push_create: boolean;
  push_update: boolean;
  push_delete: boolean;
  recurring_read: boolean;
  multi_account: boolean;
};

export interface SyncAdapter {
  readonly id: string;
  readonly version: string;
  capabilities(): AdapterCapabilities;
  init(config: AdapterConfig): Promise<void>;
  pull(range: DateRange): Promise<ExternalEvent[]>;
  push(changes: ReadonlyArray<LocalEventChange>): Promise<PushResult[]>;
  reconcile(local: FixedEvent, remote: ExternalEvent): Reconciliation;
  healthCheck(): Promise<AdapterHealth>;
}
