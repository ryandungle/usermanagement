import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { getAuth } from "@usermanagement/auth";
import type { AppEnv } from "./env.js";
import { sessionMiddleware } from "./middleware/auth.js";
import { clientsRoute } from "./routes/clients.js";
import { companiesRoute } from "./routes/companies.js";
import { meRoute } from "./routes/me.js";
import { officesRoute } from "./routes/offices.js";
import { connectorRoute } from "./routes/connector.js";
import { statsRoute } from "./routes/stats.js";
import { usersRoute } from "./routes/users.js";

export const app = new Hono<AppEnv>()
  .use("*", logger())
  .use("*", secureHeaders())

  // Allow the Vite dev server (and any other TRUSTED_ORIGINS) to call the API with cookies.
  .use("/api/*", async (c, next) => {
    const extra = (c.env.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const handler = cors({
      origin: [c.env.BETTER_AUTH_URL, ...extra],
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    });
    return handler(c, next);
  })

  .get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }))

  // Better Auth handles everything under /api/auth/*
  .on(["GET", "POST"], "/api/auth/*", (c) => getAuth(c.env).handler(c.req.raw))

  .use("/api/*", sessionMiddleware)
  .route("/api/me", meRoute)
  .route("/api/clients", clientsRoute)
  .route("/api/companies", companiesRoute)
  .route("/api/offices", officesRoute)
  .route("/api/offices", connectorRoute)
  .route("/api/users", usersRoute)
  .route("/api/stats", statsRoute)

  .notFound((c) => c.json({ error: "Not found" }, 404))
  .onError((err, c) => {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });

export type AppType = typeof app;
