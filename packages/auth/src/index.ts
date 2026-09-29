import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { createDb, schema, type Database } from "@usermanagement/db";

export interface AuthEnv {
  /** Neon connection string. */
  DATABASE_URL: string;
  /** Secret used to sign sessions/cookies. Generate with `openssl rand -base64 32`. */
  BETTER_AUTH_SECRET: string;
  /** Public origin the app is served from, e.g. https://users.example.workers.dev */
  BETTER_AUTH_URL: string;
  /** Comma-separated extra origins allowed to call the auth API (e.g. the Vite dev server). */
  TRUSTED_ORIGINS?: string;
}

export const ROLES = ["user", "admin"] as const;
export type Role = (typeof ROLES)[number];

export function buildAuth(env: AuthEnv, db: Database = createDb(env.DATABASE_URL)) {
  const trustedOrigins = (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return betterAuth({
    appName: "User Management",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh once a day
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    user: {
      deleteUser: { enabled: true },
    },
    plugins: [
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
        defaultBanReason: "Banned by an administrator",
      }),
    ],
    advanced: {
      database: { generateId: "uuid" },
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
export type SessionUser = AuthSession["user"];

/**
 * Cache one auth instance per (isolate, DATABASE_URL). Cloudflare Workers reuse
 * isolates across requests, so this avoids rebuilding Better Auth per request
 * while still allowing different environments to coexist in tests.
 */
const cache = new Map<string, Auth>();

export function getAuth(env: AuthEnv): Auth {
  const key = `${env.DATABASE_URL}|${env.BETTER_AUTH_URL}`;
  let auth = cache.get(key);
  if (!auth) {
    auth = buildAuth(env);
    cache.set(key, auth);
  }
  return auth;
}
