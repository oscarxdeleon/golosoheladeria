import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Heladería Goloso POS" },
      { name: "description", content: "Acceso al sistema POS de Heladería Goloso para ventas, mesas, caja, domicilios y administración." },
      { property: "og:title", content: "Heladería Goloso POS" },
      { property: "og:description", content: "Sistema POS de Heladería Goloso para ventas, mesas, caja y domicilios." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: IndexRedirect,
});

const ROLE_HOME: Record<string, string> = {
  admin: "/dashboard",
  supervisor: "/dashboard",
  cajero: "/mesas",
  mesero: "/tablet-pedidos",
  domiciliario: "/domicilios",
};

function IndexRedirect() {
  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.replace("/auth");
        return;
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", sess.session.user.id);
      const list = (roles ?? []).map((r: { role: string }) => r.role);
      const primary =
        list.find((r) => r === "admin") ??
        list.find((r) => r === "supervisor") ??
        list.find((r) => r === "cajero") ??
        list.find((r) => r === "mesero") ??
        list.find((r) => r === "domiciliario") ??
        "cajero";
      window.location.replace(ROLE_HOME[primary] ?? "/pos");
    })().catch(() => {
      window.location.replace("/auth");
    });
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      Cargando…
    </div>
  );
}
