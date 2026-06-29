import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexRedirect,
});

const ROLE_HOME: Record<string, string> = {
  admin: "/dashboard",
  cajero: "/pos",
  mesero: "/mesas",
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
