import { createMiddleware } from "hono/factory";
import { getAuth } from "@usermanagement/auth";
import type { AppEnv } from "../env.js";

/** Resolves the current session (if any) and stores it on the context. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const auth = getAuth(c.env);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", result?.user ?? null);
  c.set("session", result?.session ?? null);
  await next();
});

/** 401 unless a valid session exists. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** 403 unless the signed-in user has the admin role. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  await next();
});
