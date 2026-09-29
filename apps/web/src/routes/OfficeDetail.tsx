import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BuildingIcon, HeartPulseIcon, UsersIcon } from "lucide-react";
import { ROLE_LABEL } from "@usermanagement/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteHeader } from "@/components/site-header";
import { ConnectorCard, StatusBadge } from "@/components/office/connector-card";
import { CollectionBrowser } from "@/components/office/collection-browser";
import { api, ApiError, type ManagedUser, type Office, type OfficeConnector } from "@/lib/api";
import { useMe } from "@/lib/me";

export function OfficeDetailPage({ officeId }: { officeId: string }) {
  const { me } = useMe();
  const [office, setOffice] = useState<Office | null>(null);
  const [members, setMembers] = useState<ManagedUser[] | null>(null);
  const [connector, setConnector] = useState<OfficeConnector | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOffice(null);
    setMembers(null);
    setConnector(undefined);
    setError(null);
    (async () => {
      try {
        const [o, u, c] = await Promise.all([
          api.getOffice(officeId),
          api.listUsers({ officeId, pageSize: 100, sort: "role", order: "desc" }),
          api.getConnector(officeId),
        ]);
        if (cancelled) return;
        setOffice(o.data);
        setMembers(u.data);
        setConnector(c.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load office");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [officeId]);

  if (!me) return null;

  if (error) {
    return (
      <>
        <SiteHeader title="Office" />
        <div className="text-destructive p-6 text-sm">{error}</div>
      </>
    );
  }

  const managers = members?.filter((m) => m.role === "office_manager") ?? [];

  return (
    <>
      <SiteHeader title={office?.name ?? "Office"}>
        {connector && <StatusBadge status={connector.status} />}
      </SiteHeader>
      <div className="flex flex-col gap-4 p-4 md:gap-6 lg:p-6">
        <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-sm">
          {office ? (
            <>
              <Link to="/" search={{ tab: "companies", clientId: office.clientId }} className="hover:text-foreground">{office.clientName}</Link>
              <span>›</span>
              <Link to="/" search={{ tab: "offices", clientId: office.clientId, companyId: office.companyId }} className="hover:text-foreground">{office.companyName}</Link>
              <span>›</span>
              <span className="text-foreground font-medium">{office.name}</span>
              <Badge variant="outline" className="text-muted-foreground ml-2">Physical location</Badge>
            </>
          ) : (
            <Skeleton className="h-4 w-64" />
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UsersIcon className="size-4" /> Members</CardTitle>
              <CardDescription>People who work at this location.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-end justify-between">
              <div className="text-3xl font-semibold tabular-nums">{members ? members.length : <Skeleton className="h-8 w-10" />}</div>
              <Button asChild variant="outline" size="sm">
                <Link to="/" search={{ tab: "users", officeId }}>Manage users</Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BuildingIcon className="size-4" /> Office managers</CardTitle>
              <CardDescription>Can hook up the database and manage members.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm">
              {members === null ? (
                <Skeleton className="h-4 w-40" />
              ) : managers.length === 0 ? (
                <span className="text-muted-foreground">No office manager assigned yet.</span>
              ) : (
                managers.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <span>{m.name}</span>
                    <span className="text-muted-foreground">{m.email}</span>
                    <Badge variant="outline" className="text-muted-foreground ml-auto px-1.5">{ROLE_LABEL[m.role]}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {connector === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ConnectorCard officeId={officeId} connector={connector} onChange={setConnector} />
        )}

        {connector && connector.status === "ok" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><HeartPulseIcon className="size-4" /> Patients</CardTitle>
              <CardDescription>Search patients and open a chart of procedures by date of service with payments.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild size="sm">
                <Link to="/offices/$officeId/patients" params={{ officeId }} search={{}}>Open patients</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {connector && connector.status === "ok" && <CollectionBrowser key={connector.updatedAt} officeId={officeId} />}
      </div>
    </>
  );
}
