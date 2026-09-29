/**
 * Apply pending migrations over Neon's HTTP driver (works anywhere `fetch`
 * works, including environments that block raw Postgres/WebSocket egress).
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env"), override: !process.env.DATABASE_URL });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const db = drizzle({ client: neon(url) });
await migrate(db, { migrationsFolder: path.resolve(here, "../drizzle") });
console.log("Migrations applied.");
