import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  BuildingIcon,
  Building2Icon,
  CircleHelpIcon,
  HeartPulseIcon,
  StethoscopeIcon,
  LayoutDashboardIcon,
  MapPinIcon,
  PlusCircleIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavUser } from "@/components/nav-user";
import { api, type Office } from "@/lib/api";
import { rememberedPatientsSearch } from "@/routes/Patients";
import { rememberedProceduresSearch } from "@/routes/Procedures";
import { useMe } from "@/lib/me";

type Tab = "users" | "clients" | "companies" | "offices";

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { me } = useMe();
  const search = useRouterState({ select: (s) => s.location.search as { tab?: Tab } });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTab = pathname === "/" ? (search.tab ?? "users") : null;

  const canManage = me?.permissions.canManageUsers ?? false;
  const level = me?.scope.level ?? "office";

  // Offices with a database connector get a Patients entry (last used office wins).
  const [connected, setConnected] = React.useState<Office[]>([]);
  const patientsOffice = React.useMemo(() => {
    if (connected.length === 0) return null;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem("um-clinical-office");
    } catch {}
    return connected.find((o) => o.id === remembered) ?? connected[0]!;
  }, [connected, pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!canManage) return setConnected([]);
    let cancelled = false;
    api
      .listOffices({})
      .then((r) => { if (!cancelled) setConnected(r.data.filter((o) => o.hasConnector)); })
      .catch(() => { if (!cancelled) setConnected([]); });
    return () => {
      cancelled = true;
    };
  }, [canManage, pathname]);

  const orgItems: { key: Tab; title: string; icon: React.ElementType; show: boolean }[] = [
    { key: "clients", title: "Clients", icon: ShieldCheckIcon, show: level === "global" },
    { key: "companies", title: "Companies", icon: Building2Icon, show: level === "global" || level === "client" },
    { key: "offices", title: "Offices", icon: BuildingIcon, show: level !== "office" },
  ];

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
              <Link to="/" search={{}}>
                <MapPinIcon className="!size-5" />
                <span className="text-base font-semibold">User Management</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            {canManage && (
              <SidebarMenu>
                <SidebarMenuItem className="flex items-center gap-2">
                  <SidebarMenuButton
                    asChild
                    tooltip="Quick create user"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground min-w-8 duration-200 ease-linear"
                  >
                    <Link to="/" search={{ tab: "users", create: "1" }}>
                      <PlusCircleIcon />
                      <span>Quick Create</span>
                    </Link>
                  </SidebarMenuButton>
                  <Button size="icon" className="size-8 group-data-[collapsible=icon]:opacity-0" variant="outline" asChild>
                    <Link to="/" search={{ tab: "users" }} aria-label="Search users">
                      <SearchIcon />
                    </Link>
                  </Button>
                </SidebarMenuItem>
              </SidebarMenu>
            )}
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Dashboard" isActive={activeTab === "users"}>
                  <Link to="/" search={{}}>
                    <LayoutDashboardIcon />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {canManage && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Users" isActive={activeTab === "users" && !!search.tab}>
                    <Link to="/" search={{ tab: "users" }}>
                      <UsersIcon />
                      <span>Users</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {me && orgItems.some((i) => i.show) && (
          <SidebarGroup>
            <SidebarGroupLabel>Organization</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {orgItems
                  .filter((i) => i.show)
                  .map((item) => (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton asChild tooltip={item.title} isActive={activeTab === item.key}>
                        <Link to="/" search={{ tab: item.key }}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {patientsOffice && (
          <SidebarGroup>
            <SidebarGroupLabel>Clinical</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Patients" isActive={pathname.includes("/patients")}>
                    <Link to="/offices/$officeId/patients" params={{ officeId: patientsOffice.id }} search={rememberedPatientsSearch(patientsOffice.id)}>
                      <HeartPulseIcon />
                      <span>Patients</span>
                      {connected.length > 1 && <span className="text-muted-foreground ml-auto truncate text-xs">{patientsOffice.name}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Procedures" isActive={pathname.includes("/procedures")}>
                    <Link to="/offices/$officeId/procedures" params={{ officeId: patientsOffice.id }} search={rememberedProceduresSearch(patientsOffice.id)}>
                      <StethoscopeIcon />
                      <span>Procedures</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {me && me.scope.level === "office" && me.permissions.canManageUsers && me.scope.offices.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>My offices</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {me.scope.offices.map((o) => (
                  <SidebarMenuItem key={o.id}>
                    <SidebarMenuButton asChild tooltip={o.name} isActive={pathname === `/offices/${o.id}`}>
                      <Link to="/offices/$officeId" params={{ officeId: o.id }}>
                        <BuildingIcon />
                        <span>{o.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/settings"}>
                  <Link to="/settings">
                    <SettingsIcon />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="https://github.com/ryandungle/usermanagement#readme" target="_blank" rel="noreferrer">
                    <CircleHelpIcon />
                    <span>Get Help</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/" search={{ tab: "users" }}>
                    <SearchIcon />
                    <span>Search</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
