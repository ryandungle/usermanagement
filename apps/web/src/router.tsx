import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { hasRank, isRole } from "@usermanagement/shared";
import { authClient } from "./lib/auth-client";
import { Layout } from "./components/Layout";
import { LoginPage } from "./routes/Login";
import { SettingsPage } from "./routes/Settings";
import { OfficeDetailPage } from "./routes/OfficeDetail";
import { PatientsPage, type PatientsSearch } from "./routes/Patients";
import { PatientDetailPage } from "./routes/PatientDetail";
import { DashboardPage, type DashboardSearch, type Tab } from "./routes/Dashboard";

async function currentUser() {
  const { data } = await authClient.getSession();
  return data?.user ?? null;
}

const optionalId = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const TABS: Tab[] = ["users", "clients", "companies", "offices"];

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (s: Record<string, unknown>): DashboardSearch => ({
    tab: TABS.includes(s.tab as Tab) ? (s.tab as Tab) : undefined,
    clientId: optionalId(s.clientId),
    companyId: optionalId(s.companyId),
    officeId: optionalId(s.officeId),
    create: s.create === "1" ? "1" : undefined,
  }),
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: "/login" });
  },
  component: function IndexRoute() {
    const search = indexRoute.useSearch();
    return <DashboardPage search={search} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  beforeLoad: async () => {
    if (!(await currentUser())) throw redirect({ to: "/login" });
  },
  component: SettingsPage,
});

const officeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/offices/$officeId",
  beforeLoad: async () => {
    const user = await currentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!isRole(user.role) || !hasRank({ role: user.role }, "office_manager")) throw redirect({ to: "/" });
  },
  component: function OfficeRoute() {
    const { officeId } = officeRoute.useParams();
    return <OfficeDetailPage officeId={officeId} />;
  },
});

const managerGuard = async () => {
  const user = await currentUser();
  if (!user) throw redirect({ to: "/login" });
  if (!isRole(user.role) || !hasRank({ role: user.role }, "office_manager")) throw redirect({ to: "/" });
};

const patientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/offices/$officeId/patients",
  validateSearch: (s: Record<string, unknown>): PatientsSearch => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    page: typeof s.page === "number" && s.page > 1 ? s.page : undefined,
    active: s.active === "false" ? "false" : undefined,
  }),
  beforeLoad: managerGuard,
  component: function PatientsRoute() {
    const { officeId } = patientsRoute.useParams();
    const search = patientsRoute.useSearch();
    return <PatientsPage officeId={officeId} search={search} />;
  },
});

const patientRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/offices/$officeId/patients/$patientId",
  beforeLoad: managerGuard,
  component: function PatientRoute() {
    const { officeId, patientId } = patientRoute.useParams();
    return <PatientDetailPage officeId={officeId} patientId={patientId} />;
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

const routeTree = rootRoute.addChildren([indexRoute, officeRoute, patientsRoute, patientRoute, settingsRoute, loginRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
