import { useEffect, useState } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import logoUrl from "@/assets/logo-goloso.webp";
import { usePermissions } from "@/hooks/use-permissions";
import { ConnectionStatus } from "@/components/connection-status";

import {
  LayoutDashboard,
  ShoppingCart,
  Utensils,
  Monitor,
  Bike,
  Users,
  Settings,
  HelpCircle,
  IceCream,
  Tag,
  Package,
  Boxes,
  Layers,
  Receipt,
  LogOut,
  Power,
  Loader2,
  Banknote,
  ShoppingBag,
  BellRing,
  Contact2,
  ScanFace,
  Receipt as ReceiptIcon,
  TrendingDown,
  ChefHat,
  Truck,
  Wallet,
  Clock,
  History,
  ArrowDownToLine,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { LayoutGrid, MessageSquareHeart, Activity, BarChart3, LineChart, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";

const main = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  { to: "/pos", label: "Punto de venta", icon: ShoppingCart, key: "pos" },
  { to: "/caja", label: "Caja", icon: Banknote, key: "caja" },
  { to: "/depositos", label: "Depósitos", icon: ArrowDownToLine, key: "depositos" },
  { to: "/ventas", label: "Ventas", icon: Receipt, key: "ventas" },
  { to: "/todos-pedidos", label: "Todos los pedidos", icon: ReceiptIcon, key: "todos-pedidos" },
  { to: "/historial", label: "Historial de pedidos", icon: ReceiptIcon, key: "__admin_only__" },
  { to: "/estadisticas", label: "Estadísticas", icon: LayoutDashboard, key: "__admin_only__" },
];

const orden = [
  { to: "/kds", label: "KDS", icon: ChefHat, key: "kds" },
  { to: "/mesas", label: "Mesas", icon: Utensils, key: "mesas" },
  { to: "/llevar", label: "Para llevar", icon: ShoppingBag, key: "llevar" },
  { to: "/llevar-pendientes", label: "Pendientes llevar", icon: Clock, key: "llevar-pendientes" },
  { to: "/domicilio", label: "A domicilio", icon: Bike, key: "domicilio" },
  { to: "/kiosko", label: "Autopedido", icon: Monitor, key: "kiosko" },
  { to: "/pedidos-online", label: "Pedidos en línea", icon: BellRing, key: "pedidos-online" },
  { to: "/domicilios", label: "Despacho domicilios", icon: Truck, key: "domicilios" },
  { to: "/clientes", label: "Clientes", icon: Users, key: "clientes" },
  { to: "/crm", label: "CRM", icon: Contact2, key: "crm" },
];

const menu = [
  { to: "/menu/categorias", label: "Categorías", icon: Tag, key: "menu/categorias" },
  { to: "/menu/productos", label: "Productos", icon: Package, key: "menu/productos" },
  { to: "/menu/insumos", label: "Insumos", icon: Boxes, key: "menu/insumos" },
  { to: "/menu/modificadores", label: "Grupos de modificadores", icon: Layers, key: "menu/modificadores" },
  { to: "/menu/recetas", label: "Recetas (opcional)", icon: ChefHat, key: "menu/recetas" },
  { to: "/inventario", label: "Inventario y stock", icon: Boxes, key: "inventario" },
];

const egresos = [
  { to: "/compras", label: "Nueva compra", icon: ShoppingBag, key: "compras" },
  { to: "/sugerencias-compra", label: "Sugerencias de compra", icon: ShoppingBag, key: "compras" },
  { to: "/gastos", label: "Nuevo gasto", icon: ReceiptIcon, key: "gastos" },
  { to: "/egresos", label: "Historial egresos", icon: TrendingDown, key: "egresos" },
  { to: "/deudas", label: "Deudas", icon: Wallet, key: "deudas" },
];

const reportes = [
  { to: "/reportes/resumen", label: "Resumen Financiero", icon: BarChart3, key: "reportes/resumen" },
  { to: "/reportes/ventas", label: "Ventas y Analíticas", icon: LineChart, key: "reportes/ventas" },
  { to: "/reportes/cajas", label: "Historial y Cajas", icon: ClipboardList, key: "reportes/cajas" },
  { to: "/reportes/auditoria", label: "Auditorías", icon: History, key: "reportes/auditoria" },
];

const admin = [
  { to: "/todos-pedidos", label: "Todos los pedidos", icon: ReceiptIcon, key: "todos-pedidos" },
  { to: "/mesas-admin", label: "Gestión de mesas", icon: LayoutGrid, key: "mesas-admin" },
  { to: "/opiniones", label: "Opiniones de clientes", icon: MessageSquareHeart, key: "__admin_only__" },
  { to: "/repartidores", label: "Repartidores", icon: Bike, key: "usuarios" },
  { to: "/asistencia", label: "Control de Asistencia", icon: ScanFace, key: "asistencia" },
  { to: "/empleados", label: "Empleados y Nómina", icon: Users, key: "empleados" },
  { to: "/usuarios", label: "Usuarios", icon: Users, key: "usuarios" },
  { to: "/monitoreo", label: "Monitoreo", icon: Activity, key: "__admin_only__" },
  { to: "/ajustes", label: "Ajustes", icon: Settings, key: "ajustes" },
  { to: "/ayuda", label: "Ayuda", icon: HelpCircle, key: "ayuda" },
];

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    // Failsafe: redirect no matter what after 2s
    const failsafe = setTimeout(() => {
      try { window.location.replace("/auth"); } catch {}
    }, 2000);
    try {
      // Fire-and-forget signOut (local scope avoids hanging on network)
      try { void supabase.auth.signOut({ scope: "local" }).catch(() => {}); } catch {}
      // Defensive storage cleanup
      try {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith("sb-") && k.includes("auth-token")) localStorage.removeItem(k);
        });
      } catch {}
      try { queryClient.clear(); } catch {}
      clearTimeout(failsafe);
      window.location.replace("/auth");
    } catch (e: any) {
      clearTimeout(failsafe);
      toast.error("No se pudo cerrar sesión", { description: e?.message });
      setSigningOut(false);
    }
  };
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Auto-cerrar el sheet móvil al navegar para que un solo clic abra el módulo.
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);
  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));
  const { can } = usePermissions();

  const filter = <T extends { key: string }>(arr: T[]) => arr.filter((i) => can(i.key));
  const fMain = filter(main);
  const fOrden = filter(orden);
  const fMenu = filter(menu);
  const fEgresos = filter(egresos);
  const fAdmin = filter(admin);
  const fReportes = filter(reportes);
  

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="relative mx-1 my-2 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-hero p-[1px] shadow-[0_10px_30px_-12px_color-mix(in_oklab,var(--color-primary)_55%,transparent)]">
          <div className="relative flex items-center gap-3 rounded-[calc(1rem-1px)] bg-sidebar/85 px-2.5 py-2.5 backdrop-blur-xl">
            {/* halos decorativos */}
            <div className="pointer-events-none absolute inset-0 opacity-80"
                 style={{ backgroundImage: "radial-gradient(140px 60px at 0% 0%, color-mix(in oklab, var(--color-primary) 30%, transparent), transparent 70%), radial-gradient(120px 60px at 100% 100%, color-mix(in oklab, var(--color-secondary) 25%, transparent), transparent 70%)" }} />
            {/* Logo 3D */}
            <div className="relative shrink-0">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-primary opacity-70 blur-md" aria-hidden />
              <div className="relative grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-white to-white/60 p-[2px] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),inset_0_-6px_10px_-6px_rgba(0,0,0,0.25),0_10px_20px_-8px_color-mix(in_oklab,var(--color-primary)_60%,transparent)] ring-1 ring-white/40">
                <img src={logoUrl} alt="Goloso" className="h-9 w-9 object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.25)]" />
              </div>
            </div>
            {!collapsed && (
              <div className="relative min-w-0 leading-tight">
                <div className="font-display text-[19px] font-extrabold tracking-tight bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]">
                  Goloso
                </div>
                <div className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-[0.16em] text-primary">
                  <span className="h-1 w-1 rounded-full bg-primary shadow-[0_0_6px_var(--color-primary)]" />
                  POS Heladería
                </div>
              </div>
            )}
          </div>
        </div>

      </SidebarHeader>

      <SidebarContent>
        {fMain.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-display font-bold uppercase tracking-widest text-primary/80">Operación</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {fMain.map((i) => (
                  <SidebarMenuItem key={i.to}>
                    <SidebarMenuButton asChild isActive={isActive(i.to)} tooltip={i.label}>
                      <Link to={i.to}><i.icon /><span className="font-display font-bold tracking-wide text-[15px]">{i.label}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {fOrden.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-display font-bold uppercase tracking-widest text-primary/80">Pedidos</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {fOrden.map((i) => (
                  <SidebarMenuItem key={i.to}>
                    <SidebarMenuButton asChild isActive={isActive(i.to)} tooltip={i.label}>
                      <Link to={i.to}><i.icon /><span className="font-display font-bold tracking-wide text-[15px]">{i.label}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {fMenu.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-display font-bold uppercase tracking-widest text-primary/80">Menú</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {fMenu.map((i) => (
                  <SidebarMenuItem key={i.to}>
                    <SidebarMenuButton asChild isActive={isActive(i.to)} tooltip={i.label}>
                      <Link to={i.to}><i.icon /><span className="font-display font-bold tracking-wide text-[15px]">{i.label}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {fEgresos.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-display font-bold uppercase tracking-widest text-primary/80">Egresos</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {fEgresos.map((i) => (
                  <SidebarMenuItem key={i.to}>
                    <SidebarMenuButton asChild isActive={isActive(i.to)} tooltip={i.label}>
                      <Link to={i.to}><i.icon /><span className="font-display font-bold tracking-wide text-[15px]">{i.label}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {fReportes.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-display font-bold uppercase tracking-widest text-primary/80">Reportes</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {fReportes.map((i) => (
                  <SidebarMenuItem key={i.to}>
                    <SidebarMenuButton asChild isActive={isActive(i.to)} tooltip={i.label}>
                      <Link to={i.to}><i.icon /><span className="font-display font-bold tracking-wide text-[15px]">{i.label}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {fAdmin.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-display font-bold uppercase tracking-widest text-primary/80">Administración</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {fAdmin.map((i) => (
                  <SidebarMenuItem key={i.to}>
                    <SidebarMenuButton asChild isActive={isActive(i.to)} tooltip={i.label}>
                      <Link to={i.to}><i.icon /><span className="font-display font-bold tracking-wide text-[15px]">{i.label}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-2">
        <ConnectionStatus />
        <Button
          type="button"
          disabled={signingOut}
          onClick={handleSignOut}
          aria-label="Cerrar sesión"
          className={`group relative w-full overflow-hidden rounded-xl border border-red-500/40 bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 text-white shadow-[0_8px_24px_-8px_rgba(239,68,68,0.6)] transition hover:brightness-110 hover:shadow-[0_10px_28px_-6px_rgba(239,68,68,0.75)] active:scale-[0.98] disabled:opacity-70 ${collapsed ? "h-11 justify-center px-0" : "h-11 justify-start px-3"}`}
        >
          <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(120px_60px_at_20%_0%,rgba(255,255,255,0.35),transparent_70%)]" />
          <span className="relative grid h-7 w-7 place-items-center rounded-full bg-white/20 ring-1 ring-white/40 shadow-inner">
            {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
          </span>
          {!collapsed && (
            <span className="relative ml-2 font-display text-[14px] font-extrabold uppercase tracking-wider drop-shadow-[0_1px_0_rgba(0,0,0,0.25)]">
              {signingOut ? "Cerrando…" : "Cerrar sesión"}
            </span>
          )}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
