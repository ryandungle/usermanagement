/**
 * Promote an existing user to the `admin` role.
 *
 *   pnpm seed:admin                 # uses ADMIN_EMAIL from .env
 *   pnpm seed:admin you@example.com # explicit email
 *
 * Sign up through the app first, then run this once to bootstrap your first admin.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDb, eq, user } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
if (!email) {
  console.error("Usage: pnpm seed:admin <email>  (or set ADMIN_EMAIL in .env)");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL);
const [updated] = await db
  .update(user)
  .set({ role: "admin" })
  .where(eq(user.email, email))
  .returning({ id: user.id, email: user.email, role: user.role });

if (!updated) {
  console.error(`No user found with email ${email}. Sign up in the app first.`);
  process.exit(1);
}
console.log(`Promoted ${updated.email} (${updated.id}) to ${updated.role}.`);
