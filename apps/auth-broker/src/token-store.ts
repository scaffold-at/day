import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

type SqlExecutor = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export type GoogleTokenSetInput = {
  googleSubject: string;
  email: string;
  refreshToken?: string;
  accessToken: string;
  scope: string;
  expiresIn: number;
};

export type BrokerSessionInput = {
  googleSubject: string;
  email: string;
};

export type BrokerSession = {
  token: string;
  expiresAt: Date;
};

export type StoredGoogleToken = {
  googleSubject: string;
  email: string;
  refreshToken: string;
  scope: string;
};

const SESSION_TTL_DAYS = 90;

function normalizeKey(key: string): Buffer {
  const trimmed = key.trim();
  const decoded = Buffer.from(trimmed, "base64url");
  if (decoded.length === 32) return decoded;
  const utf8 = Buffer.from(trimmed, "utf8");
  if (utf8.length === 32) return utf8;
  return createHash("sha256").update(trimmed).digest();
}

export async function encryptSecret(plaintext: string, key: string): Promise<string> {
  const cryptoKey = normalizeKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cryptoKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export async function decryptSecret(encrypted: string, key: string): Promise<string> {
  const [version, ivBase64, tagBase64, ciphertextBase64] = encrypted.split(":");
  if (version !== "v1" || !ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error("Unsupported encrypted secret format");
  }
  const decipher = createDecipheriv("aes-256-gcm", normalizeKey(key), Buffer.from(ivBase64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function initAuthBrokerSchema(sql: SqlExecutor): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS google_oauth_tokens (
      google_subject TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      encrypted_refresh_token TEXT,
      access_token_preview TEXT NOT NULL,
      scope TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS broker_sessions (
      token_hash TEXT PRIMARY KEY,
      google_subject TEXT NOT NULL REFERENCES google_oauth_tokens(google_subject) ON DELETE CASCADE,
      email TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    )
  `;
}

export async function storeGoogleTokenSet(
  sql: SqlExecutor,
  input: GoogleTokenSetInput,
  encryptionKey: string,
): Promise<void> {
  const encryptedRefreshToken = input.refreshToken
    ? await encryptSecret(input.refreshToken, encryptionKey)
    : undefined;
  const expiresAt = new Date(Date.now() + input.expiresIn * 1000);
  const accessTokenPreview = createHash("sha256").update(input.accessToken).digest("hex").slice(0, 12);

  await sql`
    INSERT INTO google_oauth_tokens (
      google_subject,
      email,
      encrypted_refresh_token,
      access_token_preview,
      scope,
      expires_at,
      updated_at
    ) VALUES (
      ${input.googleSubject},
      ${input.email},
      ${encryptedRefreshToken ?? null},
      ${accessTokenPreview},
      ${input.scope},
      ${expiresAt},
      NOW()
    )
    ON CONFLICT (google_subject) DO UPDATE SET
      email = EXCLUDED.email,
      encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, google_oauth_tokens.encrypted_refresh_token),
      access_token_preview = EXCLUDED.access_token_preview,
      scope = EXCLUDED.scope,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
  `;
}

export async function upsertBrokerSession(
  sql: SqlExecutor,
  input: BrokerSessionInput,
  signingKey: string,
): Promise<BrokerSession> {
  const token = `sday_${randomBytes(32).toString("base64url")}`;
  const tokenHash = hashBrokerSessionToken(token, signingKey);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await sql`
    INSERT INTO broker_sessions (token_hash, google_subject, email, expires_at)
    VALUES (${tokenHash}, ${input.googleSubject}, ${input.email}, ${expiresAt})
  `;

  return { token, expiresAt };
}

export function hashBrokerSessionToken(token: string, signingKey: string): string {
  return createHmac("sha256", signingKey.trim()).update(token).digest("hex");
}

export async function findGoogleTokenByBrokerSession(
  sql: SqlExecutor,
  brokerSessionToken: string,
  signingKey: string,
  encryptionKey: string,
): Promise<StoredGoogleToken | undefined> {
  const tokenHash = hashBrokerSessionToken(brokerSessionToken, signingKey);
  const rows = (await sql`
    SELECT
      t.google_subject AS "googleSubject",
      t.email,
      t.encrypted_refresh_token AS "encryptedRefreshToken",
      t.scope
    FROM broker_sessions s
    JOIN google_oauth_tokens t ON t.google_subject = s.google_subject
    WHERE s.token_hash = ${tokenHash}
      AND s.expires_at > NOW()
      AND t.encrypted_refresh_token IS NOT NULL
    LIMIT 1
  `) as Array<{
    googleSubject: string;
    email: string;
    encryptedRefreshToken: string;
    scope: string;
  }>;
  const row = rows[0];
  if (!row) return undefined;
  return {
    googleSubject: row.googleSubject,
    email: row.email,
    refreshToken: await decryptSecret(row.encryptedRefreshToken, encryptionKey),
    scope: row.scope,
  };
}
