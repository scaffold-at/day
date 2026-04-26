import {
  defaultHomeDir,
  pathExists,
  readPolicyYaml,
  readSchemaVersionFile,
  schemaVersionPath,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

type Output = {
  version: string;
  home: string;
  home_exists: boolean;
  schema_version: string | null;
  policy_present: boolean;
};

export const healthTool: Tool<Input, Output> = {
  name: "health",
  description:
    "Inspect the scaffold-day install. Returns the binary version, the resolved home directory, whether the home is initialized (schema-version.json present), and whether a policy file is loaded. Read-only, near-zero cost.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  parser: InputSchema,
  handler: async (_input: Input): Promise<Output> => {
    const home = defaultHomeDir();
    const homeExists = await pathExists(home);
    const schemaPath = schemaVersionPath(home);
    let schemaVersion: string | null = null;
    if (await pathExists(schemaPath)) {
      try {
        const file = await readSchemaVersionFile(home);
        schemaVersion = file.schema_version;
      } catch {
        // Malformed file — leave null; doctor surfaces the detail.
      }
    }
    let policyPresent = false;
    try {
      const yaml = await readPolicyYaml(home);
      policyPresent = yaml !== null;
    } catch {
      // ignored
    }
    return {
      version: "0.0.0",
      home,
      home_exists: homeExists,
      schema_version: schemaVersion,
      policy_present: policyPresent,
    };
  },
};
