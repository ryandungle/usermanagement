import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { createDb, eq, schema, userOffice, type Database } from "@usermanagement/db";
import type { Actor, Role, Scope } from "@usermanagement/shared";
import { ROLE_LEVEL, isRole } from "@usermanagement/shared";

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

/**
 * Better Auth's admin plugin needs every custom role name declared through its
 * access controller. Only app_admin gets the plugin's built-in admin
 * statements (its /admin/* endpoints); the scoped roles get the plain user set
 * and are enforced by our own hierarchy checks in @usermanagement/shared.
 */
const ac = createAccessControl(defaultStatements);
const roles = {
  user: ac.newRole({ ...userAc.statements }),
  office_manager: ac.newRole({ ...userAc.statements }),
  company_owner: ac.newRole({ ...userAc.statements }),
  client_admin: ac.newRole({ ...userAc.statements }),
  app_admin: ac.newRole({ ...adminAc.statements }),
} satisfies Record<Role, unknown>;

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
      // Accounts are provisioned by managers, never self-registered.
      disableSignUp: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh once a day
      // No cookie cache: role/ban/scope changes must take effect on the next request.
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        clientId: { type: "string", required: false, input: false },
        companyId: { type: "string", required: false, input: false },
      },
    },
    plugins: [
      admin({
        ac,
        roles,
        defaultRole: "user",
        // Only app admins may call Better Auth's own /admin/* endpoints.
        // Everything scoped goes through our hierarchy-aware API instead.
        adminRoles: ["app_admin"],
        defaultBanReason: "Banned by an administrator",
      }),
    ],
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
export type SessionUser = AuthSession["user"];

/**
 * Build the RBAC actor from a Better Auth session user. Office memberships are
 * loaded from user_office for office-level roles (one small query).
 */
export async function actorFromUser(db: Database, u: SessionUser): Promise<Actor> {
  const role: Role = isRole(u.role) ? u.role : "user";
  const officeIds =
    ROLE_LEVEL[role] === "office"
      ? (await db.select({ officeId: userOffice.officeId }).from(userOffice).where(eq(userOffice.userId, u.id))).map((r) => r.officeId)
      : [];
  return { id: u.id, role, clientId: u.clientId ?? null, companyId: u.companyId ?? null, officeIds };
}

export interface CreateManagedUserInput extends Scope {
  name: string;
  email: string;
  password: string;
  role: Role;
}

/**
 * Provision a user with an email/password credential. Bypasses the public
 * sign-up endpoint (which is disabled) but still uses Better Auth's own
 * password hasher and adapter so the account is fully compatible with sign-in.
 */
export async function createManagedUser(auth: Auth, db: Database, input: CreateManagedUserInput) {
  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(input.password);
  const created = await ctx.internalAdapter.createUser({
    name: input.name,
    email: input.email.toLowerCase(),
    emailVerified: false,
    role: input.role,
    clientId: input.clientId,
    companyId: input.companyId,
  }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: hashed,
  });
  await setUserOffices(db, created.id, input.officeIds);
  return created;
}

/** Replace a user's office memberships. */
export async function setUserOffices(db: Database, userId: string, officeIds: string[]) {
  await db.delete(userOffice).where(eq(userOffice.userId, userId));
  if (officeIds.length > 0) {
    await db.insert(userOffice).values(officeIds.map((officeId) => ({ userId, officeId })));
  }
}

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
