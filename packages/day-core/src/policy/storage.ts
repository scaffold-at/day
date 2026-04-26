import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/atomic-write";
import type { Policy } from "./policy";
import { policyHash } from "./policy";

export const POLICY_DIR = "policy";
export const POLICY_FILE = "current.yaml";
export const POLICY_SNAPSHOTS_DIR = "policy-snapshots";

export function policyDir(home: string): string {
  return path.join(home, POLICY_DIR);
}

export function policyFilePath(home: string): string {
  return path.join(policyDir(home), POLICY_FILE);
}

export async function readPolicyYaml(home: string): Promise<string | null> {
  try {
    return await readFile(policyFilePath(home), "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

export async function writePolicyYaml(home: string, yamlText: string): Promise<void> {
  await atomicWrite(policyFilePath(home), yamlText, { mode: 0o600 });
}

export function policySnapshotPath(home: string, hash: string): string {
  return path.join(home, POLICY_SNAPSHOTS_DIR, `policy-${hash}.json`);
}

export type PolicySnapshotFile = {
  schema_version: string;
  hash: string;
  captured_at: string;
  policy: Policy;
};

/**
 * Write a hash-addressed snapshot of the active policy if one does
 * not already exist. Returns the snapshot's hash.
 */
export async function writePolicySnapshot(home: string, policy: Policy): Promise<string> {
  const hash = await policyHash(policy);
  const target = policySnapshotPath(home, hash);
  try {
    await readFile(target, "utf8");
    return hash;
  } catch {
    // does not exist — create it
  }
  const payload: PolicySnapshotFile = {
    schema_version: "0.1.0",
    hash,
    captured_at: new Date().toISOString(),
    policy,
  };
  await atomicWrite(target, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return hash;
}

export async function readPolicySnapshot(
  home: string,
  hash: string,
): Promise<PolicySnapshotFile | null> {
  try {
    const raw = await readFile(policySnapshotPath(home, hash), "utf8");
    return JSON.parse(raw) as PolicySnapshotFile;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}
