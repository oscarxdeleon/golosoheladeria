import { createFileRoute } from "@tanstack/react-router";
import { AuditoriaPage } from "@/routes/_authenticated/auditoria";

export const Route = createFileRoute("/_authenticated/reportes/auditoria")({
  head: () => ({ meta: [{ title: "Auditorías · Reportes" }] }),
  component: AuditoriaPage,
});
