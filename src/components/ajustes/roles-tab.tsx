import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ALL_ROUTE_KEYS, type RolePermission } from "@/hooks/use-permissions";
import type { AppRole } from "@/hooks/use-auth";
import { ShieldCheck, ShoppingCart, Utensils, Bike } from "lucide-react";

const ROLES: { value: AppRole; label: string; desc: string; icon: typeof ShieldCheck }[] = [
  { value: "admin", label: "Administrador", desc: "Acceso total al sistema.", icon: ShieldCheck },
  { value: "cajero", label: "Cajero", desc: "POS, Autopedido, Pedidos en línea y cierre de caja a ciegas.", icon: ShoppingCart },
  { value: "mesero", label: "Mesero", desc: "Plano de mesas y envío de comandas al KDS.", icon: Utensils },
  { value: "domiciliario", label: "Domiciliario", desc: "Despacho y entrega de pedidos a domicilio.", icon: Bike },
];

export function RolesTab() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["role-permissions"],
    queryFn: async () => {
      const { data } = await supabase.from("role_permissions").select("*");
      return (data ?? []) as RolePermission[];
    },
  });

  const byRole = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const r of ROLES) m[r.value] = new Set();
    for (const p of data) if (p.allowed) m[p.role]?.add(p.route_key);
    return m;
  }, [data]);

  const groupedRoutes = useMemo(() => {
    const g: Record<string, typeof ALL_ROUTE_KEYS> = {};
    for (const r of ALL_ROUTE_KEYS) {
      g[r.group] = g[r.group] ?? [];
      g[r.group].push(r);
    }
    return g;
  }, []);

  async function toggle(role: AppRole, key: string, allowed: boolean) {
    const { error } = await supabase
      .from("role_permissions")
      .upsert({ role, route_key: key, allowed } as never, { onConflict: "role,route_key" });
    if (error) return toast.error(error.message);
    toast.success("Permiso actualizado");
    qc.invalidateQueries({ queryKey: ["role-permissions"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-7 w-7 text-primary" />
        <div>
          <h2 className="font-display text-2xl leading-tight">Roles y permisos</h2>
          <p className="text-sm text-muted-foreground">
            Define qué pantallas y funciones puede ver cada rol del establecimiento. Los cambios aplican al instante en el menú lateral y bloquean el acceso por URL.
          </p>
        </div>
      </div>

      <Tabs defaultValue="admin">
        <TabsList className="flex flex-wrap h-auto">
          {ROLES.map((r) => (
            <TabsTrigger key={r.value} value={r.value} className="gap-2">
              <r.icon className="h-4 w-4" />
              {r.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {ROLES.map((r) => {
          const enabledKeys = byRole[r.value] ?? new Set();
          const isAdminRole = r.value === "admin";
          return (
            <TabsContent key={r.value} value={r.value} className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div className="flex items-center gap-3">
                    <r.icon className="h-6 w-6 text-primary" />
                    <div>
                      <CardTitle>{r.label}</CardTitle>
                      <p className="text-sm text-muted-foreground">{r.desc}</p>
                    </div>
                  </div>
                  <Badge variant="secondary">{enabledKeys.size} permisos activos</Badge>
                </CardHeader>
                <CardContent className="space-y-6">
                  {isAdminRole && (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                      El rol <b>Administrador</b> tiene acceso total y no puede restringirse.
                    </div>
                  )}
                  {Object.entries(groupedRoutes).map(([group, items]) => (
                    <div key={group}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {items.map((it) => {
                          const checked = enabledKeys.has(it.key);
                          return (
                            <div key={it.key} className="flex items-center justify-between rounded-lg border bg-card p-3">
                              <Label className="text-sm">{it.label}</Label>
                              <Switch
                                checked={checked}
                                disabled={isAdminRole}
                                onCheckedChange={(v) => toggle(r.value, it.key, v)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
