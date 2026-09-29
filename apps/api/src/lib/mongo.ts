import { MongoClient, type Document } from "mongodb";

/** Collections we surface first when present (clinic domain). */
export const PREFERRED_COLLECTIONS = ["patient", "appointment", "payment", "procedure"];

export interface ParsedMongoUrl {
  host: string;
  database: string;
}

/** Validate a MongoDB connection string and pull out display info. */
export function parseMongoUrl(raw: string, databaseOverride?: string): ParsedMongoUrl | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "Not a valid URL" };
  }
  if (url.protocol !== "mongodb:" && url.protocol !== "mongodb+srv:") {
    return { error: "URL must start with mongodb:// or mongodb+srv://" };
  }
  const host = url.host || url.hostname;
  if (!host) return { error: "URL has no host" };
  const database = (databaseOverride ?? url.pathname.replace(/^\//, "")).trim();
  if (!database) return { error: "Include the database name in the URL path (…/mydb) or set it explicitly" };
  if (/[\/\\. "$*<>:|?]/.test(database)) return { error: "Invalid database name" };
  return { host, database };
}

/** Open a short-lived client. Workers cannot keep sockets across requests, so callers must close it. */
export function openClient(url: string) {
  return new MongoClient(url, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    socketTimeoutMS: 15000,
    maxPoolSize: 2,
    appName: "usermanagement",
  } as ConstructorParameters<typeof MongoClient>[1]);
}

export async function withClient<T>(url: string, fn: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = openClient(url);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

const SYSTEM_PREFIX = "system.";

export function isSafeCollectionName(name: string) {
  return name.length > 0 && name.length <= 120 && !name.includes("$") && !name.startsWith(SYSTEM_PREFIX);
}

/** Preferred clinic collections first (in that order), then the rest alphabetically. */
export function orderCollections(names: string[]): string[] {
  const set = new Set(names);
  const first = PREFERRED_COLLECTIONS.filter((n) => set.has(n));
  const rest = names.filter((n) => !PREFERRED_COLLECTIONS.includes(n)).sort();
  return [...first, ...rest];
}

/** Convert BSON values into plain JSON the browser can render. */
export function toPlain(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 12) return "[…]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => toPlain(v, depth + 1));
  if (typeof value === "object") {
    const v = value as Record<string, unknown> & { _bsontype?: string; toHexString?: () => string; toString?: () => string };
    switch (v._bsontype) {
      case "ObjectId":
      case "ObjectID":
        return v.toHexString?.() ?? String(v);
      case "Decimal128":
      case "Long":
      case "Int32":
      case "Double":
        return Number(v.toString?.());
      case "Binary":
        return `<binary ${(v as { length?: () => number }).length?.() ?? ""} bytes>`;
      case "UUID":
        return v.toString?.();
      case "Timestamp":
        return v.toString?.();
      case undefined:
        break;
      default:
        return v.toString?.() ?? String(v);
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = toPlain(val, depth + 1);
    return out;
  }
  return value;
}

/** Union of top-level keys across a page of documents, `_id` first, in first-seen order. */
export function inferFields(docs: Document[]): string[] {
  const seen = new Set<string>();
  for (const d of docs) for (const k of Object.keys(d)) seen.add(k);
  const fields = [...seen];
  return fields.includes("_id") ? ["_id", ...fields.filter((f) => f !== "_id")] : fields;
}
