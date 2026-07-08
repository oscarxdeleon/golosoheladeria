import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { OnlineOrdersNotifier } from "@/components/online-orders-notifier";
import { WaiterCallsNotifier } from "@/components/waiter-calls-notifier";
import { BranchProvider } from "@/contexts/branch-context";
import { BranchSelector } from "@/components/branch-selector";
import { RoleRouteGuard } from "@/components/role-route-guard";
import mascotTriggerAsset from "@/assets/goloso-mascot-trigger.png";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { profile, user, roles } = useAuth();
  const roleLabel = roles.includes("admin") ? "Administrador"
    : roles.includes("mesero") ? "Mesero"
    : roles.includes("domiciliario") ? "Domiciliario"
    : "Cajero";
  return (
    <BranchProvider>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background">
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
            <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/80 px-3 sm:px-4 backdrop-blur">
              <SidebarTrigger
                className="h-11 w-11 rounded-full bg-transparent hover:bg-primary/10 [&_svg]:hidden"
                aria-label="Abrir menú"
              >
                <img
                  src={mascotTriggerAsset}
                  alt="Menú Goloso"
                  className="h-10 w-10 object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.25)]"
                />
              </SidebarTrigger>
              <div className="ml-1 min-w-0 flex-1 overflow-hidden">
                <BranchSelector />
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-2 sm:gap-3 text-sm">
                <div className="hidden sm:block text-right leading-tight">
                  <div className="font-medium">{profile?.full_name ?? user?.email}</div>
                  <div className="text-xs text-muted-foreground">{roleLabel}</div>
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary font-semibold">
                  {(profile?.full_name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
                </div>
              </div>
            </header>
            <main className="flex-1 p-3 sm:p-4 md:p-6 min-w-0 overflow-x-hidden">
              <RoleRouteGuard />
              <Outlet />
            </main>
            <OnlineOrdersNotifier />
            <WaiterCallsNotifier />
          </div>
        </div>
      </SidebarProvider>
    </BranchProvider>
  );
}
