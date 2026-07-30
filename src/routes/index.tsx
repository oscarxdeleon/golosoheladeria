import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Heladería Goloso — Menú Digital" },
      { name: "description", content: "Explora nuestro menú en línea, helados, toppings y realiza tu pedido en la sede seleccionada." },
      { property: "og:title", content: "Heladería Goloso — Menú Digital" },
      { property: "og:description", content: "Explora nuestro menú en línea, helados, toppings y realiza tu pedido en la sede seleccionada." },
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
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!sess.session) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      // Consulta tolerante a fallos transitorios: si falla, mandamos a /pos
      // (ruta segura autenticada) en vez de rebotar al login y crear un loop.
      let primary = "cajero";
      try {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", sess.session.user.id);
        const list = (roles ?? []).map((r: { role: string }) => r.role);
        primary =
          list.find((r) => r === "admin") ??
          list.find((r) => r === "supervisor") ??
          list.find((r) => r === "cajero") ??
          list.find((r) => r === "mesero") ??
          list.find((r) => r === "domiciliario") ??
          "cajero";
      } catch {
        // ignorar y usar fallback
      }
      if (cancelled) return;
      navigate({ to: ROLE_HOME[primary] ?? "/pos", replace: true });
    })().catch(() => {
      if (!cancelled) navigate({ to: "/auth", replace: true });
    });
    return () => { cancelled = true; };
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      Cargando…
    </div>
  );
}
