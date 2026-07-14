import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BarChart3, TrendingUp, ClipboardList, History } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reportes")({
  head: () => ({ meta: [{ title: "Reportes · Goloso POS" }] }),
  component: ReportesLayout,
});

const tabs = [
  { to: "/reportes/resumen", label: "Resumen Financiero", icon: BarChart3 },
  { to: "/reportes/ventas", label: "Ventas y Analíticas", icon: TrendingUp },
  { to: "/reportes/cajas", label: "Historial y Cajas", icon: ClipboardList },
  { to: "/reportes/auditoria", label: "Auditorías", icon: History },
] as const;

function ReportesLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-secondary/5 p-5 shadow-elegant">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 text-white shadow-lg">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight">Reportes</h1>
            <p className="text-sm text-muted-foreground">Centro unificado de información financiera, comercial y de auditoría.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((t) => {
            const active = pathname.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-md"
                    : "bg-background hover:bg-muted border-border text-foreground/80",
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      <Outlet />
    </div>
  );
}
