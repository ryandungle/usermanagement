import { BanIcon, BuildingIcon, Building2Icon, ShieldCheckIcon, UsersIcon } from "lucide-react";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Me, Overview } from "@/lib/api";

export function SectionCards({ me, overview }: { me: Me; overview: Overview | null }) {
  const level = me.scope.level;
  const t = overview?.totals;
  const cards = [
    {
      key: "users",
      label: "Total users",
      value: t?.users,
      icon: UsersIcon,
      foot: t ? `${t.users - t.banned} active` : "",
      sub: "Everyone inside your scope",
      show: true,
    },
    {
      key: "banned",
      label: "Banned",
      value: t?.banned,
      icon: BanIcon,
      foot: t && t.users ? `${Math.round((t.banned / t.users) * 100)}% of users` : "0%",
      sub: "Blocked from signing in",
      show: true,
    },
    {
      key: "clients",
      label: "Clients",
      value: t?.clients,
      icon: ShieldCheckIcon,
      foot: "Top of the tree",
      sub: "Each has its own companies",
      show: level === "global",
    },
    {
      key: "companies",
      label: "Companies",
      value: t?.companies,
      icon: Building2Icon,
      foot: "Legal entities",
      sub: "Each has its own offices",
      show: level === "global" || level === "client",
    },
    {
      key: "offices",
      label: "Offices",
      value: t?.offices,
      icon: BuildingIcon,
      foot: "Physical locations",
      sub: "A user can work at several",
      show: level !== "office",
    },
  ].filter((c) => c.show);

  const cols = { 1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5" }[cards.length] ?? "xl:grid-cols-4";

  return (
    <div className={`*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs sm:grid-cols-2 lg:px-6 ${cols}`}>
      {cards.map((c) => (
        <Card key={c.key} className="@container/card">
          <CardHeader>
            <CardDescription>{c.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {c.value === undefined ? <Skeleton className="h-8 w-16" /> : c.value.toLocaleString()}
            </CardTitle>
            <div className="absolute right-4 top-4">
              <c.icon className="text-muted-foreground size-4" />
            </div>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">{c.foot}</div>
            <div className="text-muted-foreground">{c.sub}</div>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
