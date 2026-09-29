import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

/**
 * Same-origin in both dev (Vite proxies /api -> wrangler) and prod (one Worker),
 * so no baseURL is required.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [adminClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;

export type SessionUser = NonNullable<ReturnType<typeof useSession>["data"]>["user"];
