// Alias del módulo de Auditoría dentro de Reportes.
// Reutiliza la implementación existente para mantener historial, filtros y permisos.
import { createFileRoute } from "@tanstack/react-router";
import { Route as AuditRoute } from "@/routes/_authenticated/auditoria";

export const Route = createFileRoute("/_authenticated/reportes/auditoria")({
  head: () => ({ meta: [{ title: "Auditorías · Reportes" }] }),
  component: AuditRoute.options.component!,
});
