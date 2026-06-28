import { Link, useRouterState } from "@tanstack/react-router";
import logoAsset from "@/assets/logo-goloso.png.asset.json";

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
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

const main = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/pos", label: "Punto de venta", icon: ShoppingCart },
  { to: "/caja", label: "Caja", icon: Banknote },
  { to: "/ventas", label: "Ventas", icon: Receipt },
];

const orden = [
  { to: "/mesas", label: "Mesas", icon: Utensils },
  { to: "/llevar", label: "Para llevar", icon: ShoppingBag },
  { to: "/domicilio", label: "A domicilio", icon: Bike },
  { to: "/kiosko", label: "Kiosko", icon: Monitor },
  { to: "/pedidos-online", label: "Pedidos en línea", icon: BellRing },
  { to: "/kds", label: "KDS", icon: Monitor },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/crm", label: "CRM", icon: Contact2 },
];

const menu = [
  { to: "/menu/categorias", label: "Categorías", icon: Tag },
  { to: "/menu/productos", label: "Productos", icon: Package },
  { to: "/menu/insumos", label: "Insumos", icon: Boxes },
  { to: "/menu/modificadores", label: "Grupos de modificadores", icon: Layers },
  { to: "/inventario", label: "Inventario y stock", icon: Boxes },
];

const admin = [
  { to: "/usuarios", label: "Usuarios", icon: Users },
  { to: "/ajustes", label: "Ajustes", icon: Settings },
  { to: "/ayuda", label: "Ayuda", icon: HelpCircle },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));
  const menuOpenDefault = menu.some((m) => isActive(m.to));

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
        <SidebarGroup>
          <SidebarGroupLabel>Operación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {main.map((i) => (
                <SidebarMenuItem key={i.to}>
                  <SidebarMenuButton asChild isActive={isActive(i.to)} tooltip={i.label}>
                    <Link to={i.to}>
                      <i.icon />
                      <span>{i.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Pedidos</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {orden.map((i) => (
                <SidebarMenuItem key={i.to}>
                  <SidebarMenuButton asChild isActive={isActive(i.to)} tooltip={i.label}>
                    <Link to={i.to}>
                      <i.icon />
                      <span>{i.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>



        <Collapsible defaultOpen={menuOpenDefault} className="group/collapsible">
          <SidebarGroup>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer">
                Menú
                <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {menu.map((i) => (
                    <SidebarMenuItem key={i.to}>
                      <SidebarMenuButton asChild isActive={isActive(i.to)} tooltip={i.label}>
                        <Link to={i.to}>
                          <i.icon />
                          <span>{i.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

        <SidebarGroup>
          <SidebarGroupLabel>Administración</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {admin.map((i) => (
                <SidebarMenuItem key={i.to}>
                  <SidebarMenuButton asChild isActive={isActive(i.to)} tooltip={i.label}>
                    <Link to={i.to}>
                      <i.icon />
                      <span>{i.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
