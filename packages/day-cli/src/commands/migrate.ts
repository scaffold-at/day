import {
  compareSchemaVersions,
  createMigrationBackup,
  CURRENT_SCHEMA_VERSION,
  defaultHomeDir,
  findMigrationPath,
  MIGRATORS,
  ScaffoldError,
  readSchemaVersionFile,
  type SchemaVersion,
  writeSchemaVersionFile,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";

type Mode = "dry-run" | "apply";

function parseFlags(args: string[]): Mode {
  const dry = args.includes("--dry-run");
  const apply = args.includes("--apply");
  if (dry && apply) {
    throw new ScaffoldError({
      code: "DAY_USAGE",
      summary: {
        en: "--dry-run and --apply are mutually exclusive",
        ko: "--dry-run 과 --apply 는 함께 쓸 수 없습니다",
      },
      cause: "Pick one: --dry-run to preview, --apply to write changes.",
      try: ["Run again with just --dry-run, or just --apply."],
    });
  }
  return apply ? "apply" : "dry-run";
}

export const migrateCommand: Command = {
  name: "migrate",
  summary: "preview or apply schema migrations on the local scaffold-day home",
  help: {
    what: "Compare the on-disk schema_version with the version this binary expects, then list (or run) the chain of migrations that brings the home to the target.",
    when: "After upgrading scaffold-day, when `doctor` reports a version mismatch, or before any operation that requires the latest schema.",
    cost: "Local read of ~/scaffold-day/.scaffold-day/schema-version.json. On --apply: a full directory snapshot under .scaffold-day/.backups/<timestamp>/ before any migrator runs. No network.",
    input: "[--dry-run] (default — preview only) | [--apply] (run migrators after backup)",
    return: "Exit 0 on success. DAY_NOT_INITIALIZED if home missing. DAY_SCHEMA_FUTURE_VERSION if data is newer than this binary. DAY_USAGE on flag conflicts.",
    gotcha: "v0.1 ships zero migrators (noop). The plumbing exists so future version bumps are non-destructive. Backup runs before the FIRST migrator, not per-step. Tracking SLICES.md §S4.",
  },
  run: async (args) => {
    const mode = parseFlags(args);
    const home = defaultHomeDir();
    const file = await readSchemaVersionFile(home);
    const ordering = compareSchemaVersions(file.schema_version, CURRENT_SCHEMA_VERSION);

    if (ordering > 0) {
      throw new ScaffoldError({
        code: "DAY_SCHEMA_FUTURE_VERSION",
        summary: {
          en: `local schema ${file.schema_version} is newer than this binary (${CURRENT_SCHEMA_VERSION})`,
          ko: `로컬 schema(${file.schema_version})가 이 바이너리(${CURRENT_SCHEMA_VERSION})보다 최신입니다`,
        },
        cause: `Refusing to read or migrate data written by a newer scaffold-day.\nLocal schema_version: ${file.schema_version}\nBinary expects:        ${CURRENT_SCHEMA_VERSION}`,
        try: [
          "Upgrade scaffold-day with `scaffold-day self-update` (or your package manager).",
          "If you intentionally downgraded, restore a backup from .scaffold-day/.backups/.",
        ],
        context: { local: file.schema_version, expected: CURRENT_SCHEMA_VERSION, home },
      });
    }

    if (ordering === 0) {
      console.log(`scaffold-day migrate (${mode})`);
      console.log(`  schema_version: ${file.schema_version} (already at target)`);
      console.log(`  No migrations to apply.`);
      return 0;
    }

    const path = findMigrationPath(
      file.schema_version,
      CURRENT_SCHEMA_VERSION as SchemaVersion,
      MIGRATORS,
    );
    if (path === null) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: {
          en: `no migration path from ${file.schema_version} to ${CURRENT_SCHEMA_VERSION}`,
          ko: `${file.schema_version} → ${CURRENT_SCHEMA_VERSION} 마이그레이션 경로가 없습니다`,
        },
        cause: "The migrator registry has no chain that reaches the target version.",
        try: [
          "Upgrade scaffold-day to the version that owns the missing migrator.",
          "File a bug at https://github.com/scaffold-at/day/issues.",
        ],
        context: {
          from: file.schema_version,
          to: CURRENT_SCHEMA_VERSION,
          registered: MIGRATORS.length,
        },
      });
    }

    console.log(`scaffold-day migrate (${mode})`);
    console.log(`  current schema_version: ${file.schema_version}`);
    console.log(`  target  schema_version: ${CURRENT_SCHEMA_VERSION}`);
    console.log(`  pending migrations: ${path.length}`);
    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      if (!step) continue;
      console.log(`    [${i + 1}/${path.length}] ${step.from} → ${step.to}  ${step.description}`);
    }

    if (mode === "dry-run") {
      console.log(`\n(dry-run) no changes written. Re-run with --apply to execute.`);
      return 0;
    }

    const backupPath = await createMigrationBackup(home);
    console.log(`\nBacked up home to: ${backupPath}`);

    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      if (!step) continue;
      console.log(`  applying [${i + 1}/${path.length}] ${step.from} → ${step.to}`);
      await step.apply(home);
    }

    await writeSchemaVersionFile(home, {
      ...file,
      schema_version: CURRENT_SCHEMA_VERSION,
      last_migrated_at: new Date().toISOString(),
    });
    console.log(`\nUpdated schema_version: ${CURRENT_SCHEMA_VERSION}`);
    return 0;
  },
};
