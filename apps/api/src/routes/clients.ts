import { Hono } from "hono";
import { z } from "zod";
import { asc, client, company, count, createDb, eq } from "@usermanagement/db";
import { scopeContains } from "@usermanagement/shared";
import type { AppEnv } from "../env.js";
import { getActor, requireAuth, requireRank } from "../middleware/auth.js";

const idParam = z.object({ id: z.uuid() });
const body = z.object({ name: z.string().trim().min(1).max(120) });

/** /api/clients — top of the tree. Only app admins create/delete. */
export const clientsRoute = new Hono<AppEnv>()
  .use("*", requireAuth)

  // Everyone sees the clients inside their scope (all for app admins, one otherwise).
  .get("/", async (c) => {
    const actor = getActor(c);
    const db = createDb(c.env.DATABASE_URL);
    const rows = await db
      .select({
        id: client.id,
        name: client.name,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt,
        companyCount: count(company.id),
      })
      .from(client)
      .leftJoin(company, eq(company.clientId, client.id))
      .where(actor.clientId ? eq(client.id, actor.clientId) : undefined)
      .groupBy(client.id)
      .orderBy(asc(client.name));
    return c.json({ data: rows });
  })

  .post("/", requireRank("app_admin"), async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const [row] = await db
      .insert(client)
      .values({ id: crypto.randomUUID(), name: parsed.data.name })
      .returning();
    return c.json({ data: row }, 201);
  })

  .get("/:id", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid id" }, 400);
    const actor = getActor(c);
    if (!scopeContains(actor, { clientId: params.data.id, companyId: actor.companyId, officeIds: actor.officeIds })) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const db = createDb(c.env.DATABASE_URL);
    const [row] = await db.select().from(client).where(eq(client.id, params.data.id));
    if (!row) return c.json({ error: "Client not found" }, 404);
    return c.json({ data: row });
  })

  // Client admins may rename their own client.
  .patch("/:id", requireRank("client_admin"), async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid id" }, 400);
    const parsed = body.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const actor = getActor(c);
    if (actor.clientId && actor.clientId !== params.data.id) return c.json({ error: "Forbidden" }, 403);
    const db = createDb(c.env.DATABASE_URL);
    const [row] = await db
      .update(client)
      .set({ name: parsed.data.name })
      .where(eq(client.id, params.data.id))
      .returning();
    if (!row) return c.json({ error: "Client not found" }, 404);
    return c.json({ data: row });
  })

  // Deleting a client cascades to its companies, offices and users.
  .delete("/:id", requireRank("app_admin"), async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid id" }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const [row] = await db.delete(client).where(eq(client.id, params.data.id)).returning({ id: client.id });
    if (!row) return c.json({ error: "Client not found" }, 404);
    return c.json({ data: { success: true } });
  });
