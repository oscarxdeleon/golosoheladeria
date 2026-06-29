import { useEffect } from "react";
import { useRouterState, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/use-permissions";

export function RoleRouteGuard() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { canPath, loading, home, isAdmin } = usePermissions();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || isAdmin) return;
    // Allow root always (will redirect handled separately if dashboard blocked)
    if (pathname === "/") {
      if (home !== "/") navigate({ to: home, replace: true });
      return;
    }
    if (!canPath(pathname)) {
      toast.error("No tienes permisos para acceder a esta sección");
      navigate({ to: home, replace: true });
    }
  }, [pathname, loading, isAdmin, canPath, home, navigate]);

  return null;
}
