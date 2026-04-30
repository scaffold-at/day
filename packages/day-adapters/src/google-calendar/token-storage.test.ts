import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deleteGoogleOAuthToken,
  type GoogleOAuthToken,
  readGoogleOAuthToken,
  tokenFilePath,
  writeGoogleOAuthToken,
} from "./token-storage";
import {
  KEYCHAIN_REFRESH_SENTINEL_PREFIX,
  _resetKeychainCache,
} from "./keychain";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-token-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const baseToken: GoogleOAuthToken = {
  access_token: "ya29.dummy-access",
  refresh_token: "1//refresh-real-secret",
  token_type: "Bearer",
  expiry_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  scope: "https://www.googleapis.com/auth/calendar",
  account_email: "u@example.com",
  storage: "file",
};

describe("token-storage with keychain disabled (forced file mode)", () => {
  let priorEnv: string | undefined;
  beforeEach(() => {
    priorEnv = process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN;
    process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN = "1";
    _resetKeychainCache();
  });
  afterEach(() => {
    if (priorEnv === undefined) delete process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN;
    else process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN = priorEnv;
    _resetKeychainCache();
  });

  test("write → read round-trips refresh_token verbatim (no sentinel)", async () => {
    const written = await writeGoogleOAuthToken(home, baseToken);
    expect(written.storage).toBe("file");
    expect(written.refresh_token).toBe("1//refresh-real-secret");

    const onDisk = await readFile(tokenFilePath(home), "utf8");
    expect(onDisk).toContain("1//refresh-real-secret");
    expect(onDisk).not.toContain(KEYCHAIN_REFRESH_SENTINEL_PREFIX);

    const read = await readGoogleOAuthToken(home);
    expect(read).not.toBeNull();
    expect(read!.refresh_token).toBe("1//refresh-real-secret");
    expect(read!.storage).toBe("file");
  });

  test("preferFile=true also forces file mode regardless of env", async () => {
    delete process.env.SCAFFOLD_DAY_DISABLE_KEYCHAIN;
    _resetKeychainCache();
    const written = await writeGoogleOAuthToken(home, baseToken, { preferFile: true });
    expect(written.storage).toBe("file");
    expect(written.refresh_token).toBe("1//refresh-real-secret");
  });

  test("delete removes the file and reports true; missing file → false", async () => {
    await writeGoogleOAuthToken(home, baseToken);
    const r1 = await deleteGoogleOAuthToken(home);
    expect(r1).toBe(true);
    const r2 = await deleteGoogleOAuthToken(home);
    expect(r2).toBe(false);
  });

  test("malformed file → DAY_INVALID_INPUT", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const target = tokenFilePath(home);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "{ this is not json", "utf8");
    let caught: unknown;
    try {
      await readGoogleOAuthToken(home);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
  });
});
