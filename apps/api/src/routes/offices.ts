import { Hono } from "hono";
import { z } from "zod";
import { and, asc, client, company, count, createDb, eq, inArray, office, userOffice } from "@usermanagement/db";
import { scopeContains } from "@usermanagement/shared";
import type { AppEnv } from "../env.js";
import { officeAsScope, resolveCompany, resolveOffice } from "../lib/scope.js";
import { getActor, requireAuth, requireRank } from "../middleware/auth.js";

const idParam = z.object({ id: z.uuid() });
const listQuery = z.object({ companyId: z.uuid().optional(), clientId: z.uuid().optional() });
const createBody = z.object({ companyId: z.uuid(), name: z.string().trim().min(1).max(120) });
const updateBody = z.object({ name: z.string().trim().min(1).max(120) });

/** /api/offices — created by company owners inside their company. */
export const officesRoute = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/", async (c) => {
    const q = listQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "Invalid query" }, 400);
    const actor = getActor(c);
    const companyId = q.data.companyId ?? actor.companyId ?? undefined;
    const clientId = q.data.clientId ?? actor.clientId ?? undefined;
    if (companyId && actor.companyId && companyId !== actor.companyId) return c.json({ error: "Forbidden" }, 403);
    if (clientId && actor.clientId && clientId !== actor.clientId) return c.json({ error: "Forbidden" }, 403);

    const db = createDb(c.env.DATABASE_URL);
    const rows = await db
      .select({
        id: office.id,
        companyId: office.companyId,
        companyName: company.name,
        clientId: company.clientId,
        clientName: client.name,
        name: office.name,
        createdAt: office.createdAt,
        updatedAt: office.updatedAt,
        userCount: count(userOffice.userId),
      })
      .from(office)
      .innerJoin(company, eq(company.id, office.companyId))
      .innerJoin(client, eq(client.id, company.clientId))
      .leftJoin(userOffice, eq(userOffice.officeId, office.id))
      .where(
        and(
          companyId ? eq(office.companyId, companyId) : undefined,
          clientId ? eq(company.clientId, clientId) : undefined,
          actor.officeIds.length ? inArray(office.id, actor.officeIds) : undefined,
        ),
      )
      .groupBy(office.id, company.name, company.clientId, client.name)
      .orderBy(asc(office.name));
    return c.json({ data: rows });
  })

  .post("/", requireRank("company_owner"), async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const parent = await resolveCompany(db, parsed.data.companyId);
    if (!parent) return c.json({ error: "Company not found" }, 404);
    if (!scopeContains(getActor(c), { clientId: parent.clientId, companyId: parent.companyId, officeIds: [] })) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const [row] = await db
      .insert(office)
      .values({ id: crypto.randomUUID(), companyId: parsed.data.companyId, name: parsed.data.name })
      .returning();
    return c.json({ data: row }, 201);
  })

  .get("/:id", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid id" }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const row = await resolveOffice(db, params.data.id);
    if (!row) return c.json({ error: "Office not found" }, 404);
    if (!scopeContains(getActor(c), officeAsScope(row))) return c.json({ error: "Forbidden" }, 403);
    return c.json({
      data: {
        id: row.officeId,
        name: row.officeName,
        companyId: row.companyId,
        companyName: row.companyName,
        clientId: row.clientId,
        clientName: row.clientName,
      },
    });
  })

  .patch("/:id", requireRank("office_manager"), async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid id" }, 400);
    const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const existing = await resolveOffice(db, params.data.id);
    if (!existing) return c.json({ error: "Office not found" }, 404);
    if (!scopeContains(getActor(c), officeAsScope(existing))) return c.json({ error: "Forbidden" }, 403);
    const [row] = await db.update(office).set({ name: parsed.data.name }).where(eq(office.id, params.data.id)).returning();
    return c.json({ data: row });
  })

  .delete("/:id", requireRank("company_owner"), async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid id" }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const existing = await resolveOffice(db, params.data.id);
    if (!existing) return c.json({ error: "Office not found" }, 404);
    if (!scopeContains(getActor(c), officeAsScope(existing))) return c.json({ error: "Forbidden" }, 403);
    await db.delete(office).where(eq(office.id, params.data.id));
    return c.json({ data: { success: true } });
  });
