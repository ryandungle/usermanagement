import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { hasRank, isRole } from "@usermanagement/shared";
import { authClient } from "./lib/auth-client";
import { Layout } from "./components/Layout";
import { LoginPage } from "./routes/Login";
import { SettingsPage } from "./routes/Settings";
import { OfficeDetailPage } from "./routes/OfficeDetail";
import { PatientsPage, type PatientsSearch } from "./routes/Patients";
import { PatientDetailPage } from "./routes/PatientDetail";
import { ProceduresPage, type ProceduresSearch } from "./routes/Procedures";
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
    sort: ["lastName", "firstName", "patientId", "birthDate", "lastVisitDate", "city"].includes(s.sort as string) ? (s.sort as PatientsSearch["sort"]) : undefined,
    order: s.order === "desc" ? "desc" : undefined,
    dateField: s.dateField === "birthDate" ? "birthDate" : s.dateField === "lastVisitDate" ? "lastVisitDate" : undefined,
    from: typeof s.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.from) ? s.from : undefined,
    to: typeof s.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.to) ? s.to : undefined,
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

const proceduresRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/offices/$officeId/procedures",
  validateSearch: (s: Record<string, unknown>): ProceduresSearch => ({
    groupBy: ["none", "patient", "date", "both"].includes(s.groupBy as string) ? (s.groupBy as ProceduresSearch["groupBy"]) : undefined,
    from: typeof s.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.from) ? s.from : undefined,
    to: typeof s.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.to) ? s.to : undefined,
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    providerId: typeof s.providerId === "string" && s.providerId ? s.providerId : undefined,
    page: typeof s.page === "number" && s.page > 1 ? s.page : undefined,
  }),
  beforeLoad: managerGuard,
  component: function ProceduresRoute() {
    const { officeId } = proceduresRoute.useParams();
    const search = proceduresRoute.useSearch();
    return <ProceduresPage officeId={officeId} search={search} />;
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

const routeTree = rootRoute.addChildren([indexRoute, officeRoute, patientsRoute, patientRoute, proceduresRoute, settingsRoute, loginRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
