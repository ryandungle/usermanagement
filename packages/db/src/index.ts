import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { schema } from "./schema.js";

export * from "./schema.js";
export { eq, and, or, desc, asc, ilike, count, sql, inArray, isNull, exists, getTableColumns } from "drizzle-orm";

export type Database = NeonHttpDatabase<typeof schema>;

/**
 * Create a Drizzle client backed by Neon's HTTP driver.
 *
 * The HTTP driver is stateless (one fetch per query), which makes it the right
 * choice for Cloudflare Workers and other edge/serverless runtimes where a
 * long-lived TCP connection cannot be kept open.
 */
export function createDb(databaseUrl: string): Database {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create a database client");
  }
  const sql = neon(databaseUrl);
  return drizzle({ client: sql, schema, casing: "snake_case" });
}
