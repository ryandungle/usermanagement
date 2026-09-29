import { Hono } from "hono";
import { z } from "zod";
import { APIError } from "better-auth/api";
import { getAuth, ROLES } from "@usermanagement/auth";
import { and, asc, count, createDb, desc, eq, ilike, or, user } from "@usermanagement/db";
import type { AppEnv } from "../env.js";
import { requireAdmin } from "../middleware/auth.js";

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  role: z.enum(ROLES).optional(),
  banned: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "name", "email"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const idParam = z.object({ id: z.uuid() });

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.email().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

const roleBody = z.object({ role: z.enum(ROLES) });

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
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
};

function handleAuthError(err: unknown) {
  if (err instanceof APIError) {
    return { status: (err.statusCode || 400) as 400, body: { error: err.message } };
  }
  throw err;
}

/** Admin-only user management endpoints, mounted at /api/users. */
export const usersRoute = new Hono<AppEnv>()
  .use("*", requireAdmin)

  // GET /api/users?q=&role=&banned=&page=&pageSize=&sort=&order=
  .get("/", async (c) => {
    const parsed = listQuery.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
    }
    const { q, role, banned, page, pageSize, sort, order } = parsed.data;
    const db = createDb(c.env.DATABASE_URL);

    const where = and(
      q ? or(ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`)) : undefined,
      role ? eq(user.role, role) : undefined,
      banned ? eq(user.banned, banned === "true") : undefined,
    );

    const sortColumn = { createdAt: user.createdAt, name: user.name, email: user.email }[sort];
    const direction = order === "asc" ? asc : desc;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select(publicColumns)
        .from(user)
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

  // GET /api/users/:id
  .get("/:id", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const [row] = await db.select(publicColumns).from(user).where(eq(user.id, params.data.id));
    if (!row) return c.json({ error: "User not found" }, 404);
    return c.json({ data: row });
  })

  // PATCH /api/users/:id  { name?, email? }
  .patch("/:id", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const body = updateBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid body", issues: body.error.issues }, 400);

    try {
      const auth = getAuth(c.env);
      const updated = await auth.api.adminUpdateUser({
        headers: c.req.raw.headers,
        body: { userId: params.data.id, data: body.data },
      });
      return c.json({ data: updated });
    } catch (err) {
      const e = handleAuthError(err);
      return c.json(e.body, e.status);
    }
  })

  // PUT /api/users/:id/role  { role }
  .put("/:id/role", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const body = roleBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid body", issues: body.error.issues }, 400);
    if (params.data.id === c.get("user")!.id && body.data.role !== "admin") {
      return c.json({ error: "You cannot remove your own admin role" }, 400);
    }

    try {
      const auth = getAuth(c.env);
      const result = await auth.api.setRole({
        headers: c.req.raw.headers,
        body: { userId: params.data.id, role: body.data.role },
      });
      return c.json({ data: result.user });
    } catch (err) {
      const e = handleAuthError(err);
      return c.json(e.body, e.status);
    }
  })

  // POST /api/users/:id/ban  { reason?, expiresIn? }
  .post("/:id/ban", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    const body = banBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid body", issues: body.error.issues }, 400);
    if (params.data.id === c.get("user")!.id) {
      return c.json({ error: "You cannot ban yourself" }, 400);
    }

    try {
      const auth = getAuth(c.env);
      const result = await auth.api.banUser({
        headers: c.req.raw.headers,
        body: {
          userId: params.data.id,
          banReason: body.data.reason,
          banExpiresIn: body.data.expiresIn,
        },
      });
      return c.json({ data: result.user });
    } catch (err) {
      const e = handleAuthError(err);
      return c.json(e.body, e.status);
    }
  })

  // POST /api/users/:id/unban
  .post("/:id/unban", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);

    try {
      const auth = getAuth(c.env);
      const result = await auth.api.unbanUser({
        headers: c.req.raw.headers,
        body: { userId: params.data.id },
      });
      return c.json({ data: result.user });
    } catch (err) {
      const e = handleAuthError(err);
      return c.json(e.body, e.status);
    }
  })

  // POST /api/users/:id/revoke-sessions
  .post("/:id/revoke-sessions", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);

    try {
      const auth = getAuth(c.env);
      const result = await auth.api.revokeUserSessions({
        headers: c.req.raw.headers,
        body: { userId: params.data.id },
      });
      return c.json({ data: result });
    } catch (err) {
      const e = handleAuthError(err);
      return c.json(e.body, e.status);
    }
  })

  // DELETE /api/users/:id
  .delete("/:id", async (c) => {
    const params = idParam.safeParse(c.req.param());
    if (!params.success) return c.json({ error: "Invalid user id" }, 400);
    if (params.data.id === c.get("user")!.id) {
      return c.json({ error: "You cannot delete your own account from here" }, 400);
    }

    try {
      const auth = getAuth(c.env);
      const result = await auth.api.removeUser({
        headers: c.req.raw.headers,
        body: { userId: params.data.id },
      });
      return c.json({ data: result });
    } catch (err) {
      const e = handleAuthError(err);
      return c.json(e.body, e.status);
    }
  });
