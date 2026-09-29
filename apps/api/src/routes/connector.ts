import { Hono, type Context } from "hono";
import { z } from "zod";
import { createDb, eq, officeConnector, type Database } from "@usermanagement/db";
import { scopeContains } from "@usermanagement/shared";
import type { AppEnv } from "../env.js";
import { encryptSecret } from "../lib/crypto.js";
import { isSafeCollectionName, parseMongoUrl } from "../lib/mongo.js";
import { officeAsScope, resolveOffice, type ResolvedOffice } from "../lib/scope.js";
import { getActor, requireRank } from "../middleware/auth.js";
import type { DocsResult } from "../durable/mongo-pool.js";
import type { PatientDetail, PatientSummary } from "../lib/denticon.js";

const idParam = z.object({ id: z.uuid() });

const putBody = z.object({
  type: z.literal("mongodb").default("mongodb"),
  url: z.string().trim().min(1).max(2000),
  database: z.string().trim().min(1).max(120).optional(),
});

export const PATIENT_SORTS = ["lastName", "firstName", "patientId", "birthDate", "lastVisitDate", "city"] as const;

const patientsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  active: z.enum(["true", "false"]).optional(),
  sort: z.enum(PATIENT_SORTS).default("lastName"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
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

function errorText(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}

/** The office's pool object. Same id for the same office, so the pool is reused. */
function pool(c: Context<AppEnv>, officeId: string) {
  return c.env.MONGO_POOL.get(c.env.MONGO_POOL.idFromName(officeId));
}

/** Ping + list collections through the office's pool. Returns names or an error message. */
async function probe(c: Context<AppEnv>, officeId: string, urlEncrypted: string, database: string): Promise<{ collections: string[] } | { error: string }> {
  try {
    return { collections: await pool(c, officeId).probe(urlEncrypted, database) };
  } catch (err) {
    return { error: errorText(err) };
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

    const urlEncrypted = await encryptSecret(c.env.BETTER_AUTH_SECRET, body.data.url);
    const probed = await probe(c, r.office.officeId, urlEncrypted, parsed.database);
    if ("error" in probed) return c.json({ error: `Connection failed: ${probed.error}` }, 400);

    const values = {
      type: body.data.type,
      urlEncrypted,
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
    const probed = await probe(c, r.office.officeId, row.urlEncrypted, row.database);
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
    await pool(c, r.office.officeId).reset().catch(() => {});
    return c.json({ data: { success: true } });
  })

  // Live list of collections with estimated counts.
  .get("/:id/data/collections", async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const r = await loadOfficeForActor(c, db);
    if ("error" in r) return r.error;
    const row = await loadConnector(db, r.office);
    if (!row) return c.json({ error: "No connector configured" }, 404);
    try {
      const data = await pool(c, r.office.officeId).listCollections(row.urlEncrypted, row.database);
      return c.json({ data });
    } catch (err) {
      return c.json({ error: `Connection failed: ${errorText(err)}` }, 502);
    }
  })

  // GET /api/offices/:id/patients?q=&active=&page=&pageSize=  (Denticon patients)
  .get("/:id/patients", async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const r = await loadOfficeForActor(c, db);
    if ("error" in r) return r.error;
    const query = patientsQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Invalid query", issues: query.error.issues }, 400);
    const row = await loadConnector(db, r.office);
    if (!row) return c.json({ error: "No connector configured" }, 404);
    const { q, active, page, pageSize, sort, order } = query.data;
    try {
      const result = (await pool(c, r.office.officeId).listPatients(row.urlEncrypted, row.database, {
        q,
        page,
        pageSize,
        activeOnly: active === "true",
        sort,
        order,
      })) as { patients: PatientSummary[]; total: number };
      return c.json({
        data: result.patients,
        pagination: { page, pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / pageSize)) },
      });
    } catch (err) {
      return c.json({ error: `Query failed: ${errorText(err)}` }, 502);
    }
  })

  // GET /api/offices/:id/patients/:patientId  (patient + ledger grouped by date of service)
  .get("/:id/patients/:patientId", async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const r = await loadOfficeForActor(c, db);
    if ("error" in r) return r.error;
    const patientId = c.req.param("patientId");
    if (!/^[\w-]{1,40}$/.test(patientId)) return c.json({ error: "Invalid patient id" }, 400);
    const row = await loadConnector(db, r.office);
    if (!row) return c.json({ error: "No connector configured" }, 404);
    try {
      const detail = (await pool(c, r.office.officeId).getPatient(row.urlEncrypted, row.database, patientId)) as unknown as PatientDetail | null;
      if (!detail) return c.json({ error: "Patient not found" }, 404);
      return c.json({ data: detail });
    } catch (err) {
      return c.json({ error: `Query failed: ${errorText(err)}` }, 502);
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
    try {
      // Documents are plain JSON (BSON converted in the object); the RPC stub types cannot express `unknown`.
      const result = (await pool(c, r.office.officeId).findDocuments(row.urlEncrypted, row.database, collection, { q, page, pageSize })) as unknown as DocsResult;
      return c.json({
        data: result.docs,
        fields: result.fields,
        pagination: { page, pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / pageSize)) },
      });
    } catch (err) {
      return c.json({ error: `Query failed: ${errorText(err)}` }, 502);
    }
  });
