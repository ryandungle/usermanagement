import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { authClient } from "./lib/auth-client";
import { Layout } from "./components/Layout";
import { LoginPage } from "./routes/Login";
import { RegisterPage } from "./routes/Register";
import { ProfilePage } from "./routes/Profile";
import { UsersPage } from "./routes/Users";

async function currentUser() {
  const { data } = await authClient.getSession();
  return data?.user ?? null;
}

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: "/login" });
  },
  component: ProfilePage,
});

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  beforeLoad: async () => {
    const user = await currentUser();
    if (!user) throw redirect({ to: "/login" });
    if (user.role !== "admin") throw redirect({ to: "/" });
  },
  component: UsersPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async () => {
    if (await currentUser()) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  beforeLoad: async () => {
    if (await currentUser()) throw redirect({ to: "/" });
  },
  component: RegisterPage,
});

const routeTree = rootRoute.addChildren([indexRoute, usersRoute, loginRoute, registerRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
