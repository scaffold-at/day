import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/atomic-write";

export const POLICY_DIR = "policy";
export const POLICY_FILE = "current.yaml";

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
