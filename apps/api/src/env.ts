import type { AuthEnv, AuthSession, SessionUser } from "@usermanagement/auth";
import type { Actor } from "@usermanagement/shared";
import type { MongoPool } from "./durable/mongo-pool.js";

/** Worker bindings. Keep in sync with wrangler.jsonc `vars` and `.dev.vars`. */
export interface Bindings extends AuthEnv {
  ASSETS?: Fetcher;
  /** Durable Object namespace holding one MongoDB connection pool per office. */
  MONGO_POOL: DurableObjectNamespace<MongoPool>;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    user: SessionUser | null;
    session: AuthSession["session"] | null;
    /** RBAC view of the signed-in user (null when anonymous). */
    actor: Actor | null;
  };
};
