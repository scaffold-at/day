import type { SchemaVersion } from "./version";

export interface Migrator {
  readonly from: SchemaVersion;
  readonly to: SchemaVersion;
  readonly description: string;
  apply(home: string): Promise<void>;
}

/**
 * Registry of registered migrators. v0.1 ships empty (noop). Future
 * slices add entries chained by `from` → `to`.
 */
export const MIGRATORS: readonly Migrator[] = [];

const MAX_CHAIN_DEPTH = 100;

/**
 * Resolve a linear chain of migrators that walks `from` to `to` by
 * matching each step's `to` against the next step's `from`. Returns
 * `null` if no chain exists or if a cycle is detected.
 */
export function findMigrationPath(
  from: SchemaVersion,
  to: SchemaVersion,
  registry: readonly Migrator[] = MIGRATORS,
): Migrator[] | null {
  if (from === to) return [];

  const chain: Migrator[] = [];
  let current: SchemaVersion = from;
  const seen = new Set<SchemaVersion>();

  while (current !== to) {
    if (seen.has(current)) return null;
    if (chain.length >= MAX_CHAIN_DEPTH) return null;
    seen.add(current);

    const next = registry.find((m) => m.from === current);
    if (!next) return null;

    chain.push(next);
    current = next.to;
  }

  return chain;
}
