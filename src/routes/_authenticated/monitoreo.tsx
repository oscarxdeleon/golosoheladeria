import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Database, ShieldAlert, RefreshCw, Clock, AlertCircle } from "lucide-react";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_authenticated/monitoreo")({
  component: MonitoreoGate,
});

function MonitoreoGate() {
  const { isAdmin, loading } = usePermissions();
  if (loading) return <div className="p-8 text-muted-foreground">Cargando…</div>;
  if (!isAdmin) return <div className="p-8 text-muted-foreground">Solo administradores.</div>;
  return <MonitoreoPage />;
}

interface FailedLogin {
  id: string;
  email: string | null;
  ip: string | null;
  reason: string | null;
  created_at: string;
}
interface AuditEvent {
  id: string;
  entity: string;
  action: string;
  user_name: string | null;
  created_at: string;
}

function fmt(d: string | Date | null) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "medium" });
}

function MonitoreoPage() {
  const conn = useConnectionStatus();

  const failedLogins = useQuery({
    queryKey: ["monitoreo", "failed-logins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("failed_login_attempts")
        .select("id,email,ip,reason,created_at")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as FailedLogin[];
    },
    refetchInterval: 60_000,
  });

  const recentAudit = useQuery({
    queryKey: ["monitoreo", "recent-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id,entity,action,user_name,created_at")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as AuditEvent[];
    },
    refetchInterval: 30_000,
  });

  const counts = useQuery({
    queryKey: ["monitoreo", "counts"],
    queryFn: async () => {
      const [sales, audit, failed] = await Promise.all([
        supabase.from("sales").select("id", { count: "exact", head: true }),
        supabase.from("audit_log").select("id", { count: "exact", head: true }),
        supabase
          .from("failed_login_attempts")
          .select("id", { count: "exact", head: true })
          .gt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      ]);
      return {
        sales: sales.count ?? 0,
        audit: audit.count ?? 0,
        failed24h: failed.count ?? 0,
      };
    },
    refetchInterval: 60_000,
  });

  const stateBadge =
    conn.state === "online"
      ? { label: "En línea", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" }
      : conn.state === "offline"
        ? { label: "Sin conexión", cls: "bg-red-500/15 text-red-700 border-red-500/30" }
        : conn.state === "syncing"
          ? { label: "Sincronizando", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" }
          : { label: "Conexión lenta", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" /> Monitoreo del sistema
          </h1>
          <p className="text-sm text-muted-foreground">Estado en tiempo real del POS, base de datos y seguridad.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void conn.refresh();
            void failedLogins.refetch();
            void recentAudit.refetch();
            void counts.refetch();
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Database className="h-4 w-4" /> Base de datos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className={stateBadge.cls}>{stateBadge.label}</Badge>
            <div className="text-xs text-muted-foreground mt-2">
              Latencia: {conn.lastLatencyMs != null ? `${conn.lastLatencyMs} ms` : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              Última: {fmt(conn.lastSyncAt)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" /> Intentos fallidos (24 h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{counts.data?.failed24h ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">Inicios de sesión rechazados</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" /> Ventas totales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{counts.data?.sales.toLocaleString("es-CO") ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">Registros históricos</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" /> Auditoría
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{counts.data?.audit.toLocaleString("es-CO") ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">Eventos registrados</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" /> Intentos fallidos recientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {failedLogins.isLoading ? (
              <div className="text-sm text-muted-foreground">Cargando…</div>
            ) : (failedLogins.data ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Sin intentos fallidos registrados. Todo tranquilo.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-auto">
                {(failedLogins.data ?? []).map((f) => (
                  <div key={f.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{f.email ?? "(sin email)"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {f.reason ?? "Motivo desconocido"}{f.ip ? ` · ${f.ip}` : ""}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap ml-2">{fmt(f.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Últimos eventos de auditoría
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentAudit.isLoading ? (
              <div className="text-sm text-muted-foreground">Cargando…</div>
            ) : (recentAudit.data ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">Sin eventos aún.</div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-auto">
                {(recentAudit.data ?? []).map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                    <div className="min-w-0">
                      <div className="font-medium">
                        <Badge variant="secondary" className="mr-2 text-xs">{a.entity}</Badge>
                        {a.action}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{a.user_name ?? "Sistema"}</div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap ml-2">{fmt(a.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
