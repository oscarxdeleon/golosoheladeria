import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/hooks/use-auth";

export interface RolePermission {
  id: string;
  role: AppRole;
  route_key: string;
  allowed: boolean;
}

export const ALL_ROUTE_KEYS: { key: string; label: string; group: string }[] = [
  { key: "dashboard", label: "Dashboard", group: "Operación" },
  { key: "pos", label: "Punto de venta", group: "Operación" },
  { key: "caja", label: "Caja (cierre)", group: "Operación" },
  { key: "ventas", label: "Historial de ventas", group: "Operación" },
  { key: "mesas", label: "Mesas", group: "Pedidos" },
  { key: "llevar", label: "Para llevar", group: "Pedidos" },
  { key: "llevar-pendientes", label: "Pedidos p/ llevar pendientes", group: "Pedidos" },
  { key: "domicilio", label: "A domicilio (POS)", group: "Pedidos" },
  { key: "domicilios", label: "Despacho domicilios", group: "Pedidos" },
  { key: "kiosko", label: "Pedidos Autopedido", group: "Pedidos" },
  { key: "pedidos-online", label: "Pedidos en línea", group: "Pedidos" },
  { key: "kds", label: "KDS / Cocina", group: "Pedidos" },
  { key: "clientes", label: "Clientes", group: "Pedidos" },
  { key: "crm", label: "CRM", group: "Pedidos" },
  { key: "menu/categorias", label: "Categorías", group: "Menú" },
  { key: "menu/productos", label: "Productos", group: "Menú" },
  { key: "menu/insumos", label: "Insumos", group: "Menú" },
  { key: "menu/modificadores", label: "Modificadores", group: "Menú" },
  { key: "menu/recetas", label: "Recetas (opcional)", group: "Menú" },
  { key: "inventario", label: "Inventario", group: "Menú" },
  { key: "compras", label: "Compras", group: "Egresos" },
  { key: "gastos", label: "Gastos", group: "Egresos" },
  { key: "egresos", label: "Historial egresos", group: "Egresos" },
  { key: "deudas", label: "Deudas (cobrar/pagar)", group: "Egresos" },
  { key: "mesas-admin", label: "Gestión de mesas", group: "Administración" },
  { key: "asistencia", label: "Asistencia", group: "Administración" },
  { key: "usuarios", label: "Usuarios", group: "Administración" },
  { key: "ajustes", label: "Ajustes", group: "Administración" },
  { key: "ayuda", label: "Ayuda", group: "Administración" },
];

export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/",
  cajero: "/mesas",
  mesero: "/mesas",
  domiciliario: "/domicilios",
};

export function usePermissions() {
  const { primaryRole, isAdmin, loading: authLoading, rolesLoading } = useAuth();
  const { data = [], isLoading } = useQuery({
    queryKey: ["role-permissions"],
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async (): Promise<RolePermission[]> => {
      const { data } = await supabase.from("role_permissions").select("*");
      return (data ?? []) as RolePermission[];
    },
  });

  const allowedKeys = new Set(
    data.filter((p) => p.role === primaryRole && p.allowed).map((p) => p.route_key),
  );

  function can(key: string): boolean {
    if (isAdmin) return true;
    return allowedKeys.has(key);
  }

  function canPath(pathname: string): boolean {
    if (isAdmin) return true;
    const clean = pathname.replace(/^\//, "");
    if (!clean || clean === "") return can("dashboard");
    // longest match
    const keys = Array.from(allowedKeys).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      if (clean === k || clean.startsWith(k + "/")) return true;
    }
    return false;
  }

  return { permissions: data, can, canPath, role: primaryRole, isAdmin, loading: authLoading || rolesLoading || isLoading, home: ROLE_HOME[primaryRole] };
}
