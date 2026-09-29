import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiteHeader } from "@/components/site-header";
import { SectionCards } from "@/components/dashboard/section-cards";
import { ChartAreaInteractive } from "@/components/dashboard/chart-area-interactive";
import { UsersTable } from "@/components/dashboard/users-table";
import { ClientsTable, CompaniesTable, OfficesTable } from "@/components/dashboard/org-tables";
import { api, type Overview } from "@/lib/api";
import { useMe } from "@/lib/me";

export type Tab = "users" | "clients" | "companies" | "offices";
export interface DashboardSearch {
  tab?: Tab;
  clientId?: string;
  companyId?: string;
  officeId?: string;
  create?: string;
}

export function DashboardPage({ search }: { search: DashboardSearch }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [crumbs, setCrumbs] = useState<{ client?: string; company?: string; office?: string }>({});

  const refreshOverview = useCallback(() => {
    api.overview().then(setOverview).catch(() => setOverview(null));
  }, []);

  useEffect(() => {
    if (me?.permissions.canManageUsers) refreshOverview();
  }, [me, refreshOverview]);

  // Names for the active scope filter chips.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: typeof crumbs = {};
      if (search.officeId) {
        const o = await api.getOffice(search.officeId).catch(() => null);
        if (o) Object.assign(next, { office: o.data.name, company: o.data.companyName, client: o.data.clientName });
      } else if (search.companyId) {
        const c = await api.getCompany(search.companyId).catch(() => null);
        if (c) Object.assign(next, { company: c.data.name, client: c.data.clientName });
      } else if (search.clientId) {
        const c = await api.getClient(search.clientId).catch(() => null);
        if (c) next.client = c.data.name;
      }
      if (!cancelled) setCrumbs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [search.clientId, search.companyId, search.officeId]);

  if (!me) return null;

  if (!me.permissions.canManageUsers) {
    return (
      <>
        <SiteHeader title="Dashboard" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <h2 className="text-lg font-semibold">Welcome, {me.user.name}</h2>
          <p className="text-muted-foreground max-w-md text-sm">
            You work at {me.scope.offices.map((o) => o.name).join(", ") || "an office"} ({me.scope.companyName ?? "your company"}). Management tools appear here for office managers and above.
          </p>
          <Button asChild variant="outline" size="sm"><Link to="/settings">Account settings</Link></Button>
        </div>
      </>
    );
  }

  const level = me.scope.level;
  const tabs: { key: Tab; label: string; count?: number; show: boolean }[] = [
    { key: "users" as const, label: "Users", count: overview?.totals.users, show: true },
    { key: "clients" as const, label: "Clients", count: overview?.totals.clients, show: level === "global" },
    { key: "companies" as const, label: "Companies", count: overview?.totals.companies, show: level === "global" || level === "client" },
    { key: "offices" as const, label: "Offices", count: overview?.totals.offices, show: level !== "office" },
  ].filter((t) => t.show);
  const tab: Tab = tabs.some((t) => t.key === search.tab) ? search.tab! : "users";

  const scopeChips = [
    search.clientId && { label: crumbs.client ?? "Client", clear: { tab } },
    search.companyId && { label: crumbs.company ?? "Company", clear: { tab, clientId: search.clientId } },
    search.officeId && { label: crumbs.office ?? "Office", clear: { tab, clientId: search.clientId, companyId: search.companyId } },
  ].filter(Boolean) as { label: string; clear: DashboardSearch }[];

  return (
    <>
      <SiteHeader title="Dashboard" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <SectionCards me={me} overview={overview} />
            <div className="px-4 lg:px-6">
              <ChartAreaInteractive overview={overview} />
            </div>

            <Tabs value={tab} onValueChange={(v) => navigate({ to: "/", search: { tab: v as Tab } })} className="w-full flex-col justify-start gap-4 px-4 lg:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <TabsList>
                  {tabs.map((t) => (
                    <TabsTrigger key={t.key} value={t.key}>
                      {t.label}
                      {t.count !== undefined && <Badge variant="secondary" className="ml-1 px-1.5">{t.count}</Badge>}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {scopeChips.map((chip) => (
                  <Button key={chip.label} asChild variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                    <Link to="/" search={chip.clear}>
                      {chip.label}
                      <XIcon className="size-3" />
                    </Link>
                  </Button>
                ))}
              </div>

              <TabsContent value="users" className="relative flex flex-col gap-4 overflow-auto">
                <UsersTable
                  me={me}
                  scope={{ clientId: search.clientId, companyId: search.companyId, officeId: search.officeId }}
                  openCreate={search.create === "1"}
                  onCreateHandled={() => navigate({ to: "/", search: { ...search, create: undefined }, replace: true })}
                  onChanged={refreshOverview}
                />
              </TabsContent>
              <TabsContent value="clients"><ClientsTable me={me} onChanged={refreshOverview} /></TabsContent>
              <TabsContent value="companies"><CompaniesTable me={me} clientId={search.clientId} onChanged={refreshOverview} /></TabsContent>
              <TabsContent value="offices"><OfficesTable me={me} clientId={search.clientId} companyId={search.companyId} onChanged={refreshOverview} /></TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </>
  );
}
