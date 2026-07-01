import { Link, useRouterState } from "@tanstack/react-router";
import logoAsset from "@/assets/logo-goloso.png.asset.json";
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
  Banknote,
  ShoppingBag,
  BellRing,
  Contact2,
  ScanFace,
  Receipt as ReceiptIcon,
  TrendingDown,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";

const main = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  { to: "/pos", label: "Punto de venta", icon: ShoppingCart, key: "pos" },
  { to: "/caja", label: "Caja", icon: Banknote, key: "caja" },
  { to: "/ventas", label: "Ventas", icon: Receipt, key: "ventas" },
  { to: "/historial", label: "Historial de pedidos", icon: ReceiptIcon, key: "ventas" },
];

const orden = [
  { to: "/mesas", label: "Mesas", icon: Utensils, key: "mesas" },
  { to: "/llevar", label: "Para llevar", icon: ShoppingBag, key: "llevar" },
  { to: "/domicilio", label: "A domicilio", icon: Bike, key: "domicilio" },
  { to: "/domicilios", label: "Despacho domicilios", icon: Bike, key: "domicilios" },
  { to: "/kiosko", label: "Autopedido", icon: Monitor, key: "kiosko" },
  { to: "/pedidos-online", label: "Pedidos en línea", icon: BellRing, key: "pedidos-online" },
  { to: "/kds", label: "KDS", icon: Monitor, key: "kds" },
  { to: "/clientes", label: "Clientes", icon: Users, key: "clientes" },
  { to: "/crm", label: "CRM", icon: Contact2, key: "crm" },
];

const menu = [
  { to: "/menu/categorias", label: "Categorías", icon: Tag, key: "menu/categorias" },
  { to: "/menu/productos", label: "Productos", icon: Package, key: "menu/productos" },
  { to: "/menu/insumos", label: "Insumos", icon: Boxes, key: "menu/insumos" },
  { to: "/menu/modificadores", label: "Grupos de modificadores", icon: Layers, key: "menu/modificadores" },
  { to: "/inventario", label: "Inventario y stock", icon: Boxes, key: "inventario" },
];

const egresos = [
  { to: "/compras", label: "Nueva compra", icon: ShoppingBag, key: "compras" },
  { to: "/gastos", label: "Nuevo gasto", icon: ReceiptIcon, key: "gastos" },
  { to: "/egresos", label: "Historial egresos", icon: TrendingDown, key: "egresos" },
];

const admin = [
  { to: "/mesas-admin", label: "Gestión de mesas", icon: LayoutGrid, key: "mesas-admin" },
  { to: "/repartidores", label: "Repartidores", icon: Bike, key: "usuarios" },
  { to: "/asistencia", label: "Control de Asistencia", icon: ScanFace, key: "asistencia" },
  { to: "/usuarios", label: "Usuarios", icon: Users, key: "usuarios" },
  { to: "/ajustes", label: "Ajustes", icon: Settings, key: "ajustes" },
  { to: "/ayuda", label: "Ayuda", icon: HelpCircle, key: "ayuda" },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));
  const { can } = usePermissions();
  const filter = <T extends { key: string }>(arr: T[]) => arr.filter((i) => can(i.key));
  const fMain = filter(main);
  const fOrden = filter(orden);
  const fMenu = filter(menu);
  const fEgresos = filter(egresos);
  const fAdmin = filter(admin);
  const menuOpenDefault = fMenu.some((m) => isActive(m.to));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-3">
          <img src={logoAsset.url} alt="Goloso" className="h-9 w-9 shrink-0 object-contain" />
          {!collapsed && (
            <div className="leading-tight">
              <div className="font-display text-base font-semibold">Goloso</div>
              <div className="text-xs text-muted-foreground">POS Heladería</div>
            </div>
          )}
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
          <Collapsible defaultOpen={menuOpenDefault} className="group/collapsible">
            <SidebarGroup>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="cursor-pointer font-display font-bold uppercase tracking-widest text-primary/80">
                  Menú
                  <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
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
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
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
