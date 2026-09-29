import type { AuthEnv, AuthSession, SessionUser } from "@usermanagement/auth";
import type { Actor } from "@usermanagement/shared";

/** Worker bindings. Keep in sync with wrangler.jsonc `vars` and `.dev.vars`. */
export interface Bindings extends AuthEnv {
  ASSETS?: Fetcher;
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
