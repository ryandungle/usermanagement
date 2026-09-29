/**
 * Bootstrap the first app admin.
 *
 *   pnpm seed:admin                              # uses ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME from .env
 *   pnpm seed:admin you@example.com 'Str0ngPass' "Your Name"
 *
 * If a user with that email already exists it is promoted to app_admin instead.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDb, eq, user } from "@usermanagement/db";
import { buildAuth, createManagedUser } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env"), override: !process.env.DATABASE_URL });

const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = process.argv[3] ?? process.env.ADMIN_PASSWORD ?? "";
const name = process.argv[4] ?? process.env.ADMIN_NAME ?? "App Admin";

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!email) fail("Usage: pnpm seed:admin <email> <password> [name]  (or set ADMIN_EMAIL/ADMIN_PASSWORD in .env)");
for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const) {
  if (!process.env[key]) fail(`${key} is not set. Copy .env.example to .env and fill it in.`);
}

const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,
};
const db = createDb(env.DATABASE_URL);
const auth = buildAuth(env, db);

const [existing] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.email, email));

if (existing) {
  await db
    .update(user)
    .set({ role: "app_admin", clientId: null, companyId: null })
    .where(eq(user.id, existing.id));
  console.log(`Promoted existing user ${email} (${existing.id}) to app_admin.`);
} else {
  if (password.length < 8) fail("Password must be at least 8 characters.");
  const created = await createManagedUser(auth, db, {
    name,
    email,
    password,
    role: "app_admin",
    clientId: null,
    companyId: null,
    officeIds: [],
  });
  console.log(`Created app_admin ${created.email} (${created.id}).`);
}
