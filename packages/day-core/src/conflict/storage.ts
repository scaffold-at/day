import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ScaffoldError } from "../error";
import { atomicWrite } from "../fs/atomic-write";
import { CURRENT_SCHEMA_VERSION } from "../schema/version";
import { type Conflict, ConflictSchema } from "./conflict";

export type ConflictPartitionFile = {
  schema_version: string;
  month: string;
  conflicts: Conflict[];
};

const YYYYMM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

export function conflictPath(home: string, month: string): string {
  return path.join(home, "conflicts", `${month}.json`);
}

export async function readConflicts(
  home: string,
  month: string,
): Promise<ConflictPartitionFile> {
  if (!YYYYMM_RE.test(month)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `invalid month '${month}'` },
      cause: "Month must match YYYY-MM.",
      try: ["Pass a string like 2026-04."],
      context: { month },
    });
  }
  const p = conflictPath(home, month);
  try {
    const raw = await readFile(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<ConflictPartitionFile>;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof parsed.schema_version !== "string" ||
      !Array.isArray(parsed.conflicts)
    ) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `failed to parse ${p}` },
        cause: "Missing schema_version or conflicts[].",
        try: ["Restore from backup or delete the file."],
        context: { file: p },
      });
    }
    const out: Conflict[] = [];
    for (const c of parsed.conflicts) {
      const r = ConflictSchema.safeParse(c);
      if (!r.success) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `conflict entry rejected in ${p}` },
          cause: r.error.message,
          try: ["Inspect the file."],
          context: { file: p },
        });
      }
      out.push(r.data);
    }
    return {
      schema_version: parsed.schema_version,
      month: parsed.month ?? month,
      conflicts: out,
    };
  } catch (err) {
    if (isEnoent(err)) {
      return { schema_version: CURRENT_SCHEMA_VERSION, month, conflicts: [] };
    }
    throw err;
  }
}

export async function writeConflicts(
  home: string,
  partition: ConflictPartitionFile,
): Promise<void> {
  const p = conflictPath(home, partition.month);
  await mkdir(path.dirname(p), { recursive: true });
  await atomicWrite(p, `${JSON.stringify(partition, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Merge newly detected conflicts into the month partition file: open
 * conflicts whose (kind, party_ids) signature already exists are kept
 * (stable id), brand-new conflicts are appended. Resolved/ignored
 * entries stay untouched.
 */
export async function syncConflicts(
  home: string,
  date: string,
  detected: Conflict[],
): Promise<{ partition: ConflictPartitionFile; openIdsForDate: string[] }> {
  const month = date.slice(0, 7);
  const partition = await readConflicts(home, month);

  const sig = (c: Conflict): string =>
    `${c.kind}::${[...c.party_ids].sort().join(",")}`;

  const existingByKey = new Map<string, Conflict>();
  for (const c of partition.conflicts) {
    if (c.date !== date) continue;
    if (c.status !== "open") continue;
    existingByKey.set(sig(c), c);
  }

  const newOpen: Conflict[] = [];
  for (const d of detected) {
    if (!existingByKey.has(sig(d))) newOpen.push(d);
  }

  // Kept open: same-day open conflicts whose signature still matches
  // a freshly detected one. Anything that no longer detects is
  // auto-closed (status="resolved", resolved_by="auto").
  const detectedKeys = new Set(detected.map(sig));
  const updated: Conflict[] = partition.conflicts.map((c) => {
    if (c.date !== date) return c;
    if (c.status !== "open") return c;
    if (detectedKeys.has(sig(c))) return c;
    return {
      ...c,
      status: "resolved" as const,
      resolved_at: new Date().toISOString(),
      resolved_by: "auto",
      resolution: { note: "no longer detected" },
    };
  });

  partition.conflicts = [...updated, ...newOpen];
  await writeConflicts(home, partition);

  const openIdsForDate = partition.conflicts
    .filter((c) => c.date === date && c.status === "open")
    .map((c) => c.id);

  return { partition, openIdsForDate };
}
