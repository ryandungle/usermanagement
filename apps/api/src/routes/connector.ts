import { Hono, type Context } from "hono";
import { z } from "zod";
import { createDb, eq, officeConnector, type Database } from "@usermanagement/db";
import { scopeContains } from "@usermanagement/shared";
import type { AppEnv } from "../env.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { inferFields, isSafeCollectionName, orderCollections, parseMongoUrl, toPlain, withClient } from "../lib/mongo.js";
import { officeAsScope, resolveOffice, type ResolvedOffice } from "../lib/scope.js";
import { getActor, requireRank } from "../middleware/auth.js";

const idParam = z.object({ id: z.uuid() });

const putBody = z.object({
  type: z.literal("mongodb").default("mongodb"),
  url: z.string().trim().min(1).max(2000),
  database: z.string().trim().min(1).max(120).optional(),
});

const docsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function present(row: typeof officeConnector.$inferSelect) {
  return {
    type: row.type,
    host: row.host,
    database: row.database,
    collections: JSON.parse(row.collections) as string[],
    status: row.status,
    lastError: row.lastError,
    lastTestedAt: row.lastTestedAt,
    updatedAt: row.updatedAt,
  };
}

/** Ping + list collections. Returns names or an error message. */
async function probe(url: string, database: string): Promise<{ collections: string[] } | { error: string }> {
  try {
    return await withClient(url, async (client) => {
      const db = client.db(database);
      await db.command({ ping: 1 });
      const list = await db.listCollections({}, { nameOnly: true }).toArray();
      return { collections: orderCollections(list.map((c) => c.name).filter(isSafeCollectionName)) };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg.length > 300 ? msg.slice(0, 300) + "…" : msg };
  }
}

async function loadOfficeForActor(c: Context<AppEnv>, db: Database) {
  const params = idParam.safeParse(c.req.param());
  if (!params.success) return { error: c.json({ error: "Invalid office id" }, 400) };
  const office = await resolveOffice(db, params.data.id);
  if (!office) return { error: c.json({ error: "Office not found" }, 404) };
  if (!scopeContains(getActor(c), officeAsScope(office))) return { error: c.json({ error: "Forbidden" }, 403) };
  return { office };
}

async function loadConnector(db: Database, office: ResolvedOffice) {
  const [row] = await db.select().from(officeConnector).where(eq(officeConnector.officeId, office.officeId));
  return row ?? null;
}

/**
 * /api/offices/:id/connector — hook an office up to its external database.
 * /api/offices/:id/data — read-only browsing of that database's collections.
 * Office managers and above, inside their scope.
 */
export const connectorRoute = new Hono<AppEnv>()
  .use("*", requireRank("office_manager"))

  .get("/:id/connector", async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const r = await loadOfficeForActor(c, db);
    if ("error" in r) return r.error;
    const row = await loadConnector(db, r.office);
    return c.json({ data: row ? present(row) : null });
  })

  // Validate, test, then save (encrypted). A failing test is returned and nothing is stored.
  .put("/:id/connector", async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const r = await loadOfficeForActor(c, db);
    if ("error" in r) return r.error;
    const body = putBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid body", issues: body.error.issues }, 400);

    const parsed = parseMongoUrl(body.data.url, body.data.database);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    const probed = await probe(body.data.url, parsed.database);
    if ("error" in probed) return c.json({ error: `Connection failed: ${probed.error}` }, 400);

    const values = {
      type: body.data.type,
      urlEncrypted: await encryptSecret(c.env.BETTER_AUTH_SECRET, body.data.url),
      host: parsed.host,
      database: parsed.database,
      collections: JSON.stringify(probed.collections),
      status: "ok",
      lastError: null,
      lastTestedAt: new Date(),
      createdBy: getActor(c).id,
    };
    const [row] = await db
      .insert(officeConnector)
      .values({ officeId: r.office.officeId, ...values })
      .onConflictDoUpdate({ target: officeConnector.officeId, set: values })
      .returning();
    return c.json({ data: present(row!) });
  })

  .post("/:id/connector/test", async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const r = await loadOfficeForActor(c, db);
    if ("error" in r) return r.error;
    const row = await loadConnector(db, r.office);
    if (!row) return c.json({ error: "No connector configured" }, 404);
    const url = await decryptSecret(c.env.BETTER_AUTH_SECRET, row.urlEncrypted);
    const probed = await probe(url, row.database);
    const [updated] = await db
      .update(officeConnector)
      .set(
        "error" in probed
          ? { status: "error", lastError: probed.error, lastTestedAt: new Date() }
          : { status: "ok", lastError: null, collections: JSON.stringify(probed.collections), lastTestedAt: new Date() },
      )
      .where(eq(officeConnector.officeId, r.office.officeId))
      .returning();
    return c.json({ data: present(updated!) }, "error" in probed ? 502 : 200);
  })

  .delete("/:id/connector", async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const r = await loadOfficeForActor(c, db);
    if ("error" in r) return r.error;
    await db.delete(officeConnector).where(eq(officeConnector.officeId, r.office.officeId));
    return c.json({ data: { success: true } });
  })

  // Live list of collections with estimated counts.
  .get("/:id/data/collections", async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const r = await loadOfficeForActor(c, db);
    if ("error" in r) return r.error;
    const row = await loadConnector(db, r.office);
    if (!row) return c.json({ error: "No connector configured" }, 404);
    const url = await decryptSecret(c.env.BETTER_AUTH_SECRET, row.urlEncrypted);
    try {
      const data = await withClient(url, async (client) => {
        const mdb = client.db(row.database);
        const list = await mdb.listCollections({}, { nameOnly: true }).toArray();
        const names = orderCollections(list.map((x) => x.name).filter(isSafeCollectionName));
        return Promise.all(
          names.map(async (name) => ({ name, count: await mdb.collection(name).estimatedDocumentCount().catch(() => null) })),
        );
      });
      return c.json({ data });
    } catch (err) {
      return c.json({ error: `Connection failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
  })

  // Page through a collection. Optional `q` does a case-insensitive match on string fields of the sampled page.
  .get("/:id/data/:collection", async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const r = await loadOfficeForActor(c, db);
    if ("error" in r) return r.error;
    const collection = c.req.param("collection");
    if (!isSafeCollectionName(collection)) return c.json({ error: "Invalid collection name" }, 400);
    const query = docsQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Invalid query", issues: query.error.issues }, 400);
    const { q, page, pageSize } = query.data;

    const row = await loadConnector(db, r.office);
    if (!row) return c.json({ error: "No connector configured" }, 404);
    const url = await decryptSecret(c.env.BETTER_AUTH_SECRET, row.urlEncrypted);

    try {
      const result = await withClient(url, async (client) => {
        const coll = client.db(row.database).collection(collection);
        let filter: Record<string, unknown> = {};
        if (q) {
          // Find string fields from a small sample, then regex-match any of them.
          const sample = await coll.find({}, { limit: 50 }).toArray();
          const stringFields = new Set<string>();
          for (const d of sample) for (const [k, v] of Object.entries(d)) if (typeof v === "string") stringFields.add(k);
          const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          filter = stringFields.size ? { $or: [...stringFields].map((f) => ({ [f]: { $regex: escaped, $options: "i" } })) } : { _id: null };
        }
        const [docs, total] = await Promise.all([
          coll.find(filter).sort({ _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
          coll.countDocuments(filter, { limit: 100_000 }),
        ]);
        return { docs: docs.map((d) => toPlain(d) as Record<string, unknown>), fields: inferFields(docs), total };
      });
      return c.json({
        data: result.docs,
        fields: result.fields,
        pagination: { page, pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / pageSize)) },
      });
    } catch (err) {
      return c.json({ error: `Query failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
  });
