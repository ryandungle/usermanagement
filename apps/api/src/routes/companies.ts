import { Hono } from "hono";
import { z } from "zod";
import { and, asc, client, company, count, createDb, eq, office } from "@usermanagement/db";
import { scopeContains } from "@usermanagement/shared";
import type { AppEnv } from "../env.js";
import { resolveCompany } from "../lib/scope.js";
import { getActor, requireAuth, requireRank } from "../middleware/auth.js";

const idParam = z.object({ id: z.uuid() });
const listQuery = z.object({ clientId: z.uuid().optional() });
const createBody = z.object({ clientId: z.uuid(), name: z.string().trim().min(1).max(120) });
const updateBody = z.object({ name: z.string().trim().min(1).max(120) });

/** /api/companies — created by client admins inside their client. */
export const companiesRoute = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/", async (c) => {
    const q = listQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "Invalid query" }, 400);
    const actor = getActor(c);
    const clientId = q.data.clientId ?? actor.clientId ?? undefined;
    if (clientId && actor.clientId && clientId !== actor.clientId) return c.json({ error: "Forbidden" }, 403);

    const db = createDb(c.env.DATABASE_URL);
    const rows = await db
      .select({
        id: company.id,
        clientId: company.clientId,
        clientName: client.name,
        name: company.name,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
        officeCount: count(office.id),
      })
      .from(company)
      .innerJoin(client, eq(client.id, company.clientId))
      .leftJoin(office, eq(office.companyId, company.id))
      .where(
        and(
          clientId ? eq(company.clientId, clientId) : undefined,
          actor.companyId ? eq(company.id, actor.companyId) : undefined,
        ),
      )
      .groupBy(company.id, client.name)
      .orderBy(asc(company.name));
    return c.json({ data: rows });
  })

  .post("/", requireRank("client_admin"), async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const actor = getActor(c);
    if (!scopeContains(actor, { clientId: parsed.data.clientId, companyId: null, officeId: null })) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const db = createDb(c.env.DATABASE_URL);
    const [exists] = await db.select({ id: client.id }).from(client).where(eq(client.id, parsed.data.clientId));
    if (!exists) return c.json({ error: "Client not found" }, 404);
    const [row] = await db
      .insert(company)
      .values({ id: crypto.randomUUID(), clientId: parsed.data.clientId, name: parsed.data.name })
      .returning();
    return c.json({ data: row }, 201);
  })

  .get("/:id", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid id" }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const row = await resolveCompany(db, params.data.id);
    if (!row) return c.json({ error: "Company not found" }, 404);
    const actor = getActor(c);
    if (!scopeContains(actor, { clientId: row.clientId, companyId: row.companyId, officeId: actor.officeId })) {
      return c.json({ error: "Forbidden" }, 403);
    }
    return c.json({ data: { id: row.companyId, name: row.companyName, clientId: row.clientId, clientName: row.clientName } });
  })

  .patch("/:id", requireRank("company_owner"), async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid id" }, 400);
    const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const existing = await resolveCompany(db, params.data.id);
    if (!existing) return c.json({ error: "Company not found" }, 404);
    if (!scopeContains(getActor(c), { clientId: existing.clientId, companyId: existing.companyId, officeId: null })) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const [row] = await db.update(company).set({ name: parsed.data.name }).where(eq(company.id, params.data.id)).returning();
    return c.json({ data: row });
  })

  .delete("/:id", requireRank("client_admin"), async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid id" }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const existing = await resolveCompany(db, params.data.id);
    if (!existing) return c.json({ error: "Company not found" }, 404);
    if (!scopeContains(getActor(c), { clientId: existing.clientId, companyId: existing.companyId, officeId: null })) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await db.delete(company).where(eq(company.id, params.data.id));
    return c.json({ data: { success: true } });
  });
