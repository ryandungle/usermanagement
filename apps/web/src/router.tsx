import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { hasRank, isRole } from "@usermanagement/shared";
import { authClient } from "./lib/auth-client";
import { Layout } from "./components/Layout";
import { LoginPage } from "./routes/Login";
import { ProfilePage } from "./routes/Profile";
import { OrgPage, type OrgSearch } from "./routes/Org";
import { UsersPage, type UsersSearch } from "./routes/Users";

async function currentUser() {
  const { data } = await authClient.getSession();
  return data?.user ?? null;
}

const optionalId = (v: unknown) => (typeof v === "string" && v ? v : undefined);

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: "/login" });
  },
  component: ProfilePage,
});

const orgRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/org",
  validateSearch: (s: Record<string, unknown>): OrgSearch => ({
    clientId: optionalId(s.clientId),
    companyId: optionalId(s.companyId),
  }),
  beforeLoad: async () => {
    const user = await currentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!isRole(user.role) || user.role === "user") throw redirect({ to: "/" });
  },
  component: function OrgRoute() {
    const search = orgRoute.useSearch();
    return <OrgPage search={search} />;
  },
});

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  validateSearch: (s: Record<string, unknown>): UsersSearch => ({
    clientId: optionalId(s.clientId),
    companyId: optionalId(s.companyId),
    officeId: optionalId(s.officeId),
  }),
  beforeLoad: async () => {
    const user = await currentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!isRole(user.role) || !hasRank({ role: user.role }, "office_manager")) throw redirect({ to: "/" });
  },
  component: function UsersRoute() {
    const search = usersRoute.useSearch();
    return <UsersPage search={search} />;
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async () => {
    if (await currentUser()) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

const routeTree = rootRoute.addChildren([indexRoute, orgRoute, usersRoute, loginRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
