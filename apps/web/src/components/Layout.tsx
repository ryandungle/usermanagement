import { Outlet, useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { MeProvider } from "@/lib/me";
import { useSession } from "@/lib/auth-client";

export function Layout() {
  return (
    <MeProvider>
      <Shell />
    </MeProvider>
  );
}

function Shell() {
  const { data: session } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!session?.user || pathname === "/login") {
    return <Outlet />;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
