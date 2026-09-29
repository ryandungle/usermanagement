import { DurableObject } from "cloudflare:workers";
import { MongoClient, type Document } from "mongodb";
import { decryptSecret } from "../lib/crypto.js";
import { inferFields, isSafeCollectionName, orderCollections, toPlain } from "../lib/mongo.js";

/** Close the pool after this long without a request. */
const IDLE_MS = 10 * 60 * 1000;
const POOL_SIZE = 5;

export interface PoolEnv {
  BETTER_AUTH_SECRET: string;
}

export interface DocsQuery {
  q?: string;
  page: number;
  pageSize: number;
}

export interface DocsResult {
  docs: Record<string, unknown>[];
  fields: string[];
  total: number;
}

/**
 * One instance per office (id = office id). Keeps a MongoClient with a small
 * connection pool alive between requests so Atlas handshakes (TLS + SRV +
 * auth) are paid once, not per HTTP request. Calls carry the encrypted
 * connection string; the object decrypts it with the Worker secret and
 * reconnects only when the string changes.
 */
export class MongoPool extends DurableObject<PoolEnv> {
  private client: MongoClient | null = null;
  private connectedTo: string | null = null; // the encrypted payload currently connected
  private lastUsed = 0;

  private async getClient(urlEncrypted: string): Promise<MongoClient> {
    if (this.client && this.connectedTo === urlEncrypted) {
      await this.touch();
      return this.client;
    }
    await this.closeClient();
    const url = await decryptSecret(this.env.BETTER_AUTH_SECRET, urlEncrypted);
    const client = new MongoClient(url, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      socketTimeoutMS: 20000,
      maxPoolSize: POOL_SIZE,
      minPoolSize: 0,
      maxIdleTimeMS: IDLE_MS,
      appName: "usermanagement-pool",
    } as ConstructorParameters<typeof MongoClient>[1]);
    await client.connect();
    this.client = client;
    this.connectedTo = urlEncrypted;
    await this.touch();
    return client;
  }

  private async touch() {
    this.lastUsed = Date.now();
    await this.ctx.storage.setAlarm(this.lastUsed + IDLE_MS);
  }

  private async closeClient() {
    const c = this.client;
    this.client = null;
    this.connectedTo = null;
    if (c) await c.close().catch(() => {});
  }

  /** Drop the client so a failed call does not poison the pool. */
  private async withClient<T>(urlEncrypted: string, fn: (client: MongoClient) => Promise<T>): Promise<T> {
    const client = await this.getClient(urlEncrypted);
    try {
      return await fn(client);
    } catch (err) {
      await this.closeClient();
      throw err;
    }
  }

  override async alarm() {
    if (Date.now() - this.lastUsed >= IDLE_MS) await this.closeClient();
    else await this.ctx.storage.setAlarm(this.lastUsed + IDLE_MS);
  }

  // ---- RPC surface (called from the Worker via env.MONGO_POOL.get(id)) ----

  /** Ping and list collections. Throws with the driver's message on failure. */
  async probe(urlEncrypted: string, database: string): Promise<string[]> {
    return this.withClient(urlEncrypted, async (client) => {
      const db = client.db(database);
      await db.command({ ping: 1 });
      const list = await db.listCollections({}, { nameOnly: true }).toArray();
      return orderCollections(list.map((c) => c.name).filter(isSafeCollectionName));
    });
  }

  async listCollections(urlEncrypted: string, database: string): Promise<{ name: string; count: number | null }[]> {
    return this.withClient(urlEncrypted, async (client) => {
      const db = client.db(database);
      const list = await db.listCollections({}, { nameOnly: true }).toArray();
      const names = orderCollections(list.map((x) => x.name).filter(isSafeCollectionName));
      return Promise.all(names.map(async (name) => ({ name, count: await db.collection(name).estimatedDocumentCount().catch(() => null) })));
    });
  }

  async findDocuments(urlEncrypted: string, database: string, collection: string, query: DocsQuery): Promise<DocsResult> {
    if (!isSafeCollectionName(collection)) throw new Error("Invalid collection name");
    return this.withClient(urlEncrypted, async (client) => {
      const coll = client.db(database).collection(collection);
      let filter: Document = {};
      if (query.q) {
        // Find string fields from a small sample, then regex-match any of them.
        const sample = await coll.find({}, { limit: 50 }).toArray();
        const stringFields = new Set<string>();
        for (const d of sample) for (const [k, v] of Object.entries(d)) if (typeof v === "string") stringFields.add(k);
        const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter = stringFields.size ? { $or: [...stringFields].map((f) => ({ [f]: { $regex: escaped, $options: "i" } })) } : { _id: null };
      }
      const skip = (query.page - 1) * query.pageSize;
      const [docs, total] = await Promise.all([
        coll.find(filter).sort({ _id: -1 }).skip(skip).limit(query.pageSize).toArray(),
        coll.countDocuments(filter, { limit: 100_000 }),
      ]);
      return { docs: docs.map((d) => toPlain(d) as Record<string, unknown>), fields: inferFields(docs), total };
    });
  }

  /** Close the pool now (connector replaced or removed). */
  async reset(): Promise<void> {
    await this.closeClient();
    await this.ctx.storage.deleteAlarm();
  }
}
