export type BrokerConfig = {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  databaseUrl: string;
  tokenEncryptionKey: string;
  brokerPublicBaseUrl: string;
  brokerSessionSigningKey: string;
};

type Env = Record<string, string | undefined>;

const REQUIRED_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "DATABASE_URL",
  "TOKEN_ENCRYPTION_KEY",
  "BROKER_SESSION_SIGNING_KEY",
] as const;

function readRequired(env: Env, name: (typeof REQUIRED_ENV)[number]): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error("BROKER_PUBLIC_BASE_URL must be a valid URL");
  }
}

function readBrokerPublicBaseUrl(env: Env): string {
  const configured = env.BROKER_PUBLIC_BASE_URL?.trim();
  if (configured) return normalizeBaseUrl(configured);

  const vercelUrl = env.VERCEL_URL?.trim();
  if (vercelUrl)
    return normalizeBaseUrl(vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`);

  throw new Error("Missing required environment variable: BROKER_PUBLIC_BASE_URL");
}

function normalizeRedirectUri(value: string): string {
  try {
    const url = new URL(value.trim());
    return url.toString();
  } catch {
    throw new Error("GOOGLE_REDIRECT_URI must be a valid URL");
  }
}

export function loadBrokerConfig(env: Env = process.env): BrokerConfig {
  const brokerPublicBaseUrl = readBrokerPublicBaseUrl(env);
  const googleRedirectUri = normalizeRedirectUri(
    env.GOOGLE_REDIRECT_URI?.trim() || `${brokerPublicBaseUrl}/api/auth/google/callback`,
  );

  return {
    googleClientId: readRequired(env, "GOOGLE_CLIENT_ID"),
    googleClientSecret: readRequired(env, "GOOGLE_CLIENT_SECRET"),
    googleRedirectUri,
    databaseUrl: readRequired(env, "DATABASE_URL"),
    tokenEncryptionKey: readRequired(env, "TOKEN_ENCRYPTION_KEY"),
    brokerPublicBaseUrl,
    brokerSessionSigningKey: readRequired(env, "BROKER_SESSION_SIGNING_KEY"),
  };
}
