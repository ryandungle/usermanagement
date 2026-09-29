import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the repo-root .env so `pnpm db:*` works from any workspace.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env"), override: !process.env.DATABASE_URL });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
