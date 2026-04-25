/**
 * Schema versioning for scaffold-day on-disk data (SLICES §S4).
 *
 * v0.1 ships at "0.1.0" and registers no migrators (noop). Future
 * slices add `Migrator` instances to walk between versions.
 */

export type SchemaVersion = `${number}.${number}.${number}`;

export const CURRENT_SCHEMA_VERSION: SchemaVersion = "0.1.0";

export type SemVerTriplet = readonly [number, number, number];

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function isSchemaVersion(value: string): value is SchemaVersion {
  return SEMVER_RE.test(value);
}

export function parseSemVer(input: string): SemVerTriplet {
  const match = SEMVER_RE.exec(input);
  if (!match) throw new Error(`invalid schema version: '${input}' (expected X.Y.Z)`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return [major, minor, patch];
}

export function compareSemVer(a: SemVerTriplet, b: SemVerTriplet): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

export function compareSchemaVersions(a: string, b: string): -1 | 0 | 1 {
  return compareSemVer(parseSemVer(a), parseSemVer(b));
}
