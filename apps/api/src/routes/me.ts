import { Hono } from "hono";
import { z } from "zod";
import { APIError } from "better-auth/api";
import { getAuth } from "@usermanagement/auth";
import { client, company, createDb, eq, office } from "@usermanagement/db";
import { ROLE_LEVEL, assignableRoles, hasRank } from "@usermanagement/shared";
import type { AppEnv } from "../env.js";
import { getActor, requireAuth } from "../middleware/auth.js";

const profileBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    image: z.url().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/** Endpoints for the signed-in user, mounted at /api/me. */
export const meRoute = new Hono<AppEnv>()
  .use("*", requireAuth)

  // GET /api/me — profile plus everything the UI needs to render permissions.
  .get("/", async (c) => {
    const actor = getActor(c);
    const db = createDb(c.env.DATABASE_URL);
    const [clientRow, companyRow, officeRow] = await Promise.all([
      actor.clientId ? db.select({ name: client.name }).from(client).where(eq(client.id, actor.clientId)) : [],
      actor.companyId ? db.select({ name: company.name }).from(company).where(eq(company.id, actor.companyId)) : [],
      actor.officeId ? db.select({ name: office.name }).from(office).where(eq(office.id, actor.officeId)) : [],
    ]);

    return c.json({
      user: c.get("user"),
      session: c.get("session"),
      actor,
      scope: {
        level: ROLE_LEVEL[actor.role],
        clientName: clientRow[0]?.name ?? null,
        companyName: companyRow[0]?.name ?? null,
        officeName: officeRow[0]?.name ?? null,
      },
      permissions: {
        assignableRoles: assignableRoles(actor),
        canManageUsers: hasRank(actor, "office_manager"),
        canCreateOffices: hasRank(actor, "company_owner"),
        canCreateCompanies: hasRank(actor, "client_admin"),
        canCreateClients: hasRank(actor, "app_admin"),
      },
    });
  })

  // PATCH /api/me  { name?, image? }
  .patch("/", async (c) => {
    const body = profileBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid body", issues: body.error.issues }, 400);
    try {
      const auth = getAuth(c.env);
      const result = await auth.api.updateUser({ headers: c.req.raw.headers, body: body.data });
      return c.json({ data: result });
    } catch (err) {
      if (err instanceof APIError) return c.json({ error: err.message }, 400);
      throw err;
    }
  })

  // GET /api/me/sessions
  .get("/sessions", async (c) => {
    const auth = getAuth(c.env);
    const sessions = await auth.api.listSessions({ headers: c.req.raw.headers });
    return c.json({ data: sessions });
  });
