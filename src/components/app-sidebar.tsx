import { useEffect, useState } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import logoUrl from "@/assets/logo-goloso.png";
import { usePermissions } from "@/hooks/use-permissions";

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
import { LayoutGrid, MessageSquareHeart } from "lucide-react";
import { Button } from "@/components/ui/button";

const main = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  { to: "/pos", label: "Punto de venta", icon: ShoppingCart, key: "pos" },
  { to: "/caja", label: "Caja", icon: Banknote, key: "caja" },
  { to: "/ventas", label: "Ventas", icon: Receipt, key: "ventas" },
  { to: "/historial", label: "Historial de pedidos", icon: ReceiptIcon, key: "__admin_only__" },
  { to: "/estadisticas", label: "Estadísticas", icon: LayoutDashboard, key: "__admin_only__" },
];

const orden = [
  { to: "/kds", label: "KDS", icon: ChefHat, key: "kds" },
  { to: "/mesas", label: "Mesas", icon: Utensils, key: "mesas" },
  { to: "/llevar", label: "Para llevar", icon: ShoppingBag, key: "llevar" },
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
  { to: "/gastos", label: "Nuevo gasto", icon: ReceiptIcon, key: "gastos" },
  { to: "/egresos", label: "Historial egresos", icon: TrendingDown, key: "egresos" },
  { to: "/deudas", label: "Deudas", icon: Wallet, key: "deudas" },
];

const admin = [
  { to: "/todos-pedidos", label: "Todos los pedidos", icon: ReceiptIcon, key: "todos-pedidos" },
  { to: "/mesas-admin", label: "Gestión de mesas", icon: LayoutGrid, key: "mesas-admin" },
  { to: "/opiniones", label: "Opiniones de clientes", icon: MessageSquareHeart, key: "__admin_only__" },
  { to: "/repartidores", label: "Repartidores", icon: Bike, key: "usuarios" },
  { to: "/asistencia", label: "Control de Asistencia", icon: ScanFace, key: "asistencia" },
  { to: "/usuarios", label: "Usuarios", icon: Users, key: "usuarios" },
  { to: "/ajustes", label: "Ajustes", icon: Settings, key: "ajustes" },
  { to: "/ayuda", label: "Ayuda", icon: HelpCircle, key: "ayuda" },
];

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
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

      <SidebarFooter>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start"
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.href = "/auth";
          }}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Cerrar sesión</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
