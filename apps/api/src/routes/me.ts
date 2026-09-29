import { Hono } from "hono";
import { z } from "zod";
import { APIError } from "better-auth/api";
import { getAuth } from "@usermanagement/auth";
import type { AppEnv } from "../env.js";
import { requireAuth } from "../middleware/auth.js";

const profileBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    image: z.url().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/** Endpoints for the signed-in user, mounted at /api/me. */
export const meRoute = new Hono<AppEnv>()
  .use("*", requireAuth)

  // GET /api/me
  .get("/", (c) => c.json({ user: c.get("user"), session: c.get("session") }))

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
