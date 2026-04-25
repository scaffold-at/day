import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { ScaffoldError } from "../error";
import { CURRENT_SCHEMA_VERSION, isSchemaVersion, type SchemaVersion } from "./version";

export type SchemaVersionFile = {
  schema_version: SchemaVersion;
  created_at: string;
  last_migrated_at: string | null;
  scaffold_day_version: string;
};

export const SCAFFOLD_DAY_HOME_ENV = "SCAFFOLD_DAY_HOME";
export const META_DIR = ".scaffold-day";
export const SCHEMA_VERSION_FILE = "schema-version.json";

export function defaultHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[SCAFFOLD_DAY_HOME_ENV];
  if (override && override.length > 0) return override;
  return path.join(homedir(), "scaffold-day");
}

export function metaDir(home: string): string {
  return path.join(home, META_DIR);
}

export function schemaVersionPath(home: string): string {
  return path.join(metaDir(home), SCHEMA_VERSION_FILE);
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function readSchemaVersionFile(home: string): Promise<SchemaVersionFile> {
  const p = schemaVersionPath(home);
  if (!(await pathExists(p))) {
    throw new ScaffoldError({
      code: "DAY_NOT_INITIALIZED",
      summary: {
        en: `scaffold-day home is not initialized at ${home}`,
        ko: `scaffold-day 홈이 초기화되지 않았습니다: ${home}`,
      },
      cause: `Required file does not exist:\n  ${p}`,
      try: [
        "Run `scaffold-day init` to create the home directory.",
        "Or set SCAFFOLD_DAY_HOME to point at an existing scaffold-day home.",
      ],
      context: { home, missing: p },
    });
  }
  const raw = await readFile(p, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: {
        en: `schema-version.json is not valid JSON`,
        ko: `schema-version.json 형식이 올바르지 않습니다`,
      },
      cause: `Failed to parse ${p}: ${(err as Error).message}`,
      try: [
        "Restore from a recent backup under .scaffold-day/.backups/.",
        "Or delete the file and re-run `scaffold-day init`.",
      ],
      context: { path: p },
    });
  }

  const file = parsed as Partial<SchemaVersionFile>;
  if (typeof file.schema_version !== "string" || !isSchemaVersion(file.schema_version)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: {
        en: "schema-version.json missing or malformed schema_version",
        ko: "schema-version.json 의 schema_version 값이 올바르지 않습니다",
      },
      cause: `Expected X.Y.Z, found: ${JSON.stringify(file.schema_version)}`,
      try: ["Restore from a backup or re-run `scaffold-day init`."],
      context: { path: p, found: file.schema_version },
    });
  }

  return {
    schema_version: file.schema_version,
    created_at: typeof file.created_at === "string" ? file.created_at : new Date().toISOString(),
    last_migrated_at: typeof file.last_migrated_at === "string" ? file.last_migrated_at : null,
    scaffold_day_version:
      typeof file.scaffold_day_version === "string" ? file.scaffold_day_version : "unknown",
  };
}

export async function writeSchemaVersionFile(
  home: string,
  file: SchemaVersionFile,
): Promise<void> {
  await mkdir(metaDir(home), { recursive: true });
  // True atomic-write (tmp + fsync + rename) lands in S8a; for now plain write.
  await writeFile(schemaVersionPath(home), `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

export function defaultSchemaVersionFile(scaffoldDayVersion: string): SchemaVersionFile {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    last_migrated_at: null,
    scaffold_day_version: scaffoldDayVersion,
  };
}
