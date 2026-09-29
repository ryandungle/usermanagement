import { Hono } from "hono";
import { z } from "zod";
import { APIError } from "better-auth/api";
import { createManagedUser, getAuth } from "@usermanagement/auth";
import {
  and,
  asc,
  client,
  company,
  count,
  createDb,
  desc,
  eq,
  ilike,
  office,
  or,
  session,
  user,
  type Database,
} from "@usermanagement/db";
import {
  ROLES,
  ROLE_LEVEL,
  canAssignRole,
  canManageUser,
  isRole,
  scopeContains,
  type Actor,
  type Scope,
} from "@usermanagement/shared";
import type { AppEnv } from "../env.js";
import { resolveScopeForLevel } from "../lib/scope.js";
import { getActor, requireRank } from "../middleware/auth.js";

const uuid = z.uuid();

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  role: z.enum(ROLES).optional(),
  banned: z.enum(["true", "false"]).optional(),
  clientId: uuid.optional(),
  companyId: uuid.optional(),
  officeId: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "name", "email", "role"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const idParam = z.object({ id: uuid });

const scopeIds = {
  clientId: uuid.optional(),
  companyId: uuid.optional(),
  officeId: uuid.optional(),
};

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email(),
  password: z.string().min(8).max(128),
  role: z.enum(ROLES),
  ...scopeIds,
});

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.email().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

const roleBody = z.object({ role: z.enum(ROLES), ...scopeIds });

const passwordBody = z.object({ password: z.string().min(8).max(128) });

const banBody = z.object({
  reason: z.string().trim().max(500).optional(),
  /** Seconds until the ban lifts. Omit for a permanent ban. */
  expiresIn: z.number().int().positive().optional(),
});

const publicColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
  image: user.image,
  role: user.role,
  banned: user.banned,
  banReason: user.banReason,
  banExpires: user.banExpires,
  clientId: user.clientId,
  companyId: user.companyId,
  officeId: user.officeId,
  clientName: client.name,
  companyName: company.name,
  officeName: office.name,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
};

function selectUsers(db: Database) {
  return db
    .select(publicColumns)
    .from(user)
    .leftJoin(client, eq(client.id, user.clientId))
    .leftJoin(company, eq(company.id, user.companyId))
    .leftJoin(office, eq(office.id, user.officeId));
}

async function loadTarget(db: Database, id: string) {
  const [row] = await selectUsers(db).where(eq(user.id, id));
  if (!row) return null;
  const actor: Actor = {
    id: row.id,
    role: isRole(row.role) ? row.role : "user",
    clientId: row.clientId,
    companyId: row.companyId,
    officeId: row.officeId,
  };
  return { row, actor };
}

/** Actor's scope as SQL conditions on the user table. */
function scopeWhere(actor: Actor) {
  return and(
    actor.clientId ? eq(user.clientId, actor.clientId) : undefined,
    actor.companyId ? eq(user.companyId, actor.companyId) : undefined,
    actor.officeId ? eq(user.officeId, actor.officeId) : undefined,
  );
}

async function revokeAllSessions(db: Database, userId: string) {
  await db.delete(session).where(eq(session.userId, userId));
}

/**
 * /api/users — hierarchy-aware user management. Office managers and above can
 * list and create; every mutation is checked with canManageUser/canAssignRole.
 */
export const usersRoute = new Hono<AppEnv>()
  .use("*", requireRank("office_manager"))

  // GET /api/users
  .get("/", async (c) => {
    const parsed = listQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
    const { q, role, banned, clientId, companyId, officeId, page, pageSize, sort, order } = parsed.data;
    const actor = getActor(c);

    // Requested filters must lie inside the actor's scope.
    const requested: Scope = {
      clientId: clientId ?? actor.clientId,
      companyId: companyId ?? actor.companyId,
      officeId: officeId ?? actor.officeId,
    };
    if (!scopeContains(actor, requested)) return c.json({ error: "Forbidden" }, 403);

    const db = createDb(c.env.DATABASE_URL);
    const where = and(
      scopeWhere(actor),
      requested.clientId ? eq(user.clientId, requested.clientId) : undefined,
      requested.companyId ? eq(user.companyId, requested.companyId) : undefined,
      requested.officeId ? eq(user.officeId, requested.officeId) : undefined,
      q ? or(ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`)) : undefined,
      role ? eq(user.role, role) : undefined,
      banned ? eq(user.banned, banned === "true") : undefined,
    );

    const sortColumn = { createdAt: user.createdAt, name: user.name, email: user.email, role: user.role }[sort];
    const direction = order === "asc" ? asc : desc;

    const [rows, [{ total }]] = await Promise.all([
      selectUsers(db)
        .where(where)
        .orderBy(direction(sortColumn), asc(user.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(user).where(where),
    ]);

    return c.json({
      data: rows,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  })

  // POST /api/users  { name, email, password, role, clientId? | companyId? | officeId? }
  .post("/", async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const actor = getActor(c);
    const { role, name, email, password } = parsed.data;

    if (!canAssignRole(actor, role)) return c.json({ error: `You cannot create a ${role}` }, 403);

    const db = createDb(c.env.DATABASE_URL);
    const resolved = await resolveScopeForLevel(db, ROLE_LEVEL[role], parsed.data);
    if ("error" in resolved) return c.json({ error: resolved.error }, 400);
    if (!scopeContains(actor, resolved.scope)) return c.json({ error: "Target scope is outside your scope" }, 403);

    const [dupe] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
    if (dupe) return c.json({ error: "A user with that email already exists" }, 409);

    try {
      const created = await createManagedUser(getAuth(c.env), { name, email, password, role, ...resolved.scope });
      const target = await loadTarget(db, created.id);
      return c.json({ data: target?.row }, 201);
    } catch (err) {
      if (err instanceof APIError) return c.json({ error: err.message }, 400);
      throw err;
    }
  })

  // GET /api/users/:id
  .get("/:id", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const target = await loadTarget(db, params.data.id);
    if (!target) return c.json({ error: "User not found" }, 404);
    const actor = getActor(c);
    if (target.actor.id !== actor.id && !scopeContains(actor, target.actor)) return c.json({ error: "Forbidden" }, 403);
    return c.json({ data: target.row });
  })

  // PATCH /api/users/:id  { name?, email? }
  .patch("/:id", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const body = updateBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid body", issues: body.error.issues }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const target = await loadTarget(db, params.data.id);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (!canManageUser(getActor(c), target.actor)) return c.json({ error: "Forbidden" }, 403);

    if (body.data.email) {
      const [dupe] = await db.select({ id: user.id }).from(user).where(eq(user.email, body.data.email.toLowerCase()));
      if (dupe && dupe.id !== target.actor.id) return c.json({ error: "A user with that email already exists" }, 409);
    }
    await db
      .update(user)
      .set({ ...body.data, email: body.data.email?.toLowerCase() })
      .where(eq(user.id, params.data.id));
    const updated = await loadTarget(db, params.data.id);
    return c.json({ data: updated?.row });
  })

  // PUT /api/users/:id/role  { role, clientId? | companyId? | officeId? }
  .put("/:id/role", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const body = roleBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid body", issues: body.error.issues }, 400);
    const actor = getActor(c);
    const db = createDb(c.env.DATABASE_URL);
    const target = await loadTarget(db, params.data.id);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (!canManageUser(actor, target.actor)) return c.json({ error: "Forbidden" }, 403);
    if (!canAssignRole(actor, body.data.role)) return c.json({ error: `You cannot assign ${body.data.role}` }, 403);

    // Fall back to the target's current ids when the caller omits them.
    const resolved = await resolveScopeForLevel(db, ROLE_LEVEL[body.data.role], {
      clientId: body.data.clientId ?? target.actor.clientId ?? undefined,
      companyId: body.data.companyId ?? target.actor.companyId ?? undefined,
      officeId: body.data.officeId ?? target.actor.officeId ?? undefined,
    });
    if ("error" in resolved) return c.json({ error: resolved.error }, 400);
    if (!scopeContains(actor, resolved.scope)) return c.json({ error: "Target scope is outside your scope" }, 403);

    await db.update(user).set({ role: body.data.role, ...resolved.scope }).where(eq(user.id, params.data.id));
    await revokeAllSessions(db, params.data.id); // force re-auth with the new permissions
    const updated = await loadTarget(db, params.data.id);
    return c.json({ data: updated?.row });
  })

  // PUT /api/users/:id/password  { password }
  .put("/:id/password", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const body = passwordBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid body", issues: body.error.issues }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const target = await loadTarget(db, params.data.id);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (!canManageUser(getActor(c), target.actor)) return c.json({ error: "Forbidden" }, 403);

    const ctx = await getAuth(c.env).$context;
    const hashed = await ctx.password.hash(body.data.password);
    await ctx.internalAdapter.updatePassword(params.data.id, hashed);
    await revokeAllSessions(db, params.data.id);
    return c.json({ data: { success: true } });
  })

  // POST /api/users/:id/ban  { reason?, expiresIn? }
  .post("/:id/ban", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const body = banBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid body", issues: body.error.issues }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const target = await loadTarget(db, params.data.id);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (!canManageUser(getActor(c), target.actor)) return c.json({ error: "Forbidden" }, 403);

    await db
      .update(user)
      .set({
        banned: true,
        banReason: body.data.reason ?? "Banned by an administrator",
        banExpires: body.data.expiresIn ? new Date(Date.now() + body.data.expiresIn * 1000) : null,
      })
      .where(eq(user.id, params.data.id));
    await revokeAllSessions(db, params.data.id);
    const updated = await loadTarget(db, params.data.id);
    return c.json({ data: updated?.row });
  })

  // POST /api/users/:id/unban
  .post("/:id/unban", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const target = await loadTarget(db, params.data.id);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (!canManageUser(getActor(c), target.actor)) return c.json({ error: "Forbidden" }, 403);

    await db.update(user).set({ banned: false, banReason: null, banExpires: null }).where(eq(user.id, params.data.id));
    const updated = await loadTarget(db, params.data.id);
    return c.json({ data: updated?.row });
  })

  // POST /api/users/:id/revoke-sessions
  .post("/:id/revoke-sessions", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const target = await loadTarget(db, params.data.id);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (!canManageUser(getActor(c), target.actor)) return c.json({ error: "Forbidden" }, 403);
    await revokeAllSessions(db, params.data.id);
    return c.json({ data: { success: true } });
  })

  // DELETE /api/users/:id
  .delete("/:id", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const target = await loadTarget(db, params.data.id);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (!canManageUser(getActor(c), target.actor)) return c.json({ error: "Forbidden" }, 403);
    await db.delete(user).where(eq(user.id, params.data.id)); // sessions/accounts cascade
    return c.json({ data: { success: true } });
  });
