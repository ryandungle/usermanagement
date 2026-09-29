import { createMiddleware } from "hono/factory";
import { actorFromUser, getAuth } from "@usermanagement/auth";
import { hasRank, type Actor, type Role } from "@usermanagement/shared";
import type { AppEnv } from "../env.js";

/** Resolves the current session (if any) and stores user/session/actor on the context. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const auth = getAuth(c.env);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", result?.user ?? null);
  c.set("session", result?.session ?? null);
  c.set("actor", result?.user ? actorFromUser(result.user) : null);
  await next();
});

/** 401 unless a valid session exists. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("actor")) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

/** 401 when anonymous, 403 unless the actor holds `min` or higher. */
export function requireRank(min: Role) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const actor = c.get("actor");
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    if (!hasRank(actor, min)) return c.json({ error: "Forbidden" }, 403);
    await next();
  });
}

/** Non-null actor for handlers that run behind requireAuth/requireRank. */
export function getActor(c: { get(key: "actor"): Actor | null }): Actor {
  const actor = c.get("actor");
  if (!actor) throw new Error("getActor called without an authenticated actor");
  return actor;
}
