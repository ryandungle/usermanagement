import type { AuthEnv } from "@usermanagement/auth";

/** Worker bindings. Keep in sync with wrangler.jsonc `vars` and `.dev.vars`. */
export interface Bindings extends AuthEnv {
  ASSETS?: Fetcher;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    user: import("@usermanagement/auth").SessionUser | null;
    session: import("@usermanagement/auth").AuthSession["session"] | null;
  };
};
