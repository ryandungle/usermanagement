import { Hono } from "hono";
import { and, client, company, count, createDb, eq, office, session, sql, user } from "@usermanagement/db";
import type { Actor } from "@usermanagement/shared";
import type { AppEnv } from "../env.js";
import { getActor, requireRank } from "../middleware/auth.js";

function scopeWhere(actor: Actor) {
  return and(
    actor.clientId ? eq(user.clientId, actor.clientId) : undefined,
    actor.companyId ? eq(user.companyId, actor.companyId) : undefined,
    actor.officeId ? eq(user.officeId, actor.officeId) : undefined,
  );
}

/** GET /api/stats/overview — headline counts plus a 90-day daily series, all inside the actor's scope. */
export const statsRoute = new Hono<AppEnv>().use("*", requireRank("office_manager")).get("/overview", async (c) => {
  const actor = getActor(c);
  const db = createDb(c.env.DATABASE_URL);
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  since.setUTCHours(0, 0, 0, 0);

  const [[users], [banned], [clients], [companies], [offices], newUsers, sessions] = await Promise.all([
    db.select({ n: count() }).from(user).where(scopeWhere(actor)),
    db.select({ n: count() }).from(user).where(and(scopeWhere(actor), eq(user.banned, true))),
    db.select({ n: count() }).from(client).where(actor.clientId ? eq(client.id, actor.clientId) : undefined),
    db
      .select({ n: count() })
      .from(company)
      .where(
        and(
          actor.clientId ? eq(company.clientId, actor.clientId) : undefined,
          actor.companyId ? eq(company.id, actor.companyId) : undefined,
        ),
      ),
    db
      .select({ n: count() })
      .from(office)
      .innerJoin(company, eq(company.id, office.companyId))
      .where(
        and(
          actor.clientId ? eq(company.clientId, actor.clientId) : undefined,
          actor.companyId ? eq(office.companyId, actor.companyId) : undefined,
          actor.officeId ? eq(office.id, actor.officeId) : undefined,
        ),
      ),
    db
      .select({ day: sql<string>`to_char(${user.createdAt}, 'YYYY-MM-DD')`, n: count() })
      .from(user)
      .where(and(scopeWhere(actor), sql`${user.createdAt} >= ${since}`))
      .groupBy(sql`1`),
    db
      .select({ day: sql<string>`to_char(${session.createdAt}, 'YYYY-MM-DD')`, n: count() })
      .from(session)
      .innerJoin(user, eq(user.id, session.userId))
      .where(and(scopeWhere(actor), sql`${session.createdAt} >= ${since}`))
      .groupBy(sql`1`),
  ]);

  // Dense daily series so the chart never has gaps.
  const byDayUsers = new Map(newUsers.map((r) => [r.day, Number(r.n)]));
  const byDaySessions = new Map(sessions.map((r) => [r.day, Number(r.n)]));
  const series: { date: string; newUsers: number; signIns: number }[] = [];
  for (let d = new Date(since); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, newUsers: byDayUsers.get(key) ?? 0, signIns: byDaySessions.get(key) ?? 0 });
  }

  return c.json({
    totals: {
      users: Number(users.n),
      banned: Number(banned.n),
      clients: Number(clients.n),
      companies: Number(companies.n),
      offices: Number(offices.n),
    },
    series,
  });
});
