import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import logoUrl from "@/assets/logo-goloso.webp";

const searchSchema = z.object({
  kiosk: z.string().optional(),
  src: z.string().optional(),
});

export const Route = createFileRoute("/tablet-auto/$token")({
  ssr: false,
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Iniciando Goloso Mesero…" },
      { name: "apple-mobile-web-app-title", content: "Goloso Mesero" },
      { name: "application-name", content: "Goloso Mesero" },
    ],
    links: [{ rel: "manifest", href: "/manifest-mesero.webmanifest" }],
  }),
  component: AutoLogin,
});

function AutoLogin() {
  const { token } = useParams({ from: "/tablet-auto/$token" });
  const search = useSearch({ from: "/tablet-auto/$token" });
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [message, setMessage] = useState("Conectando la tablet…");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        // Check if already signed in as the expected tablet user — skip re-login.
        const { data: sess } = await supabase.auth.getSession();
        const cached = typeof window !== "undefined"
          ? window.localStorage.getItem(`goloso.tablet.email.${token}`) : null;
        if (sess.session && cached && sess.session.user.email === cached) {
          redirect(search);
          return;
        }
        setMessage("Descargando credenciales…");
        const r = await fetch(`/api/public/tablet-auth/${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!r.ok) throw new Error("Tablet no registrada o desactivada");
        const { email, password, branch_slug } = await r.json();
        if (typeof window !== "undefined") {
          window.localStorage.setItem(`goloso.tablet.email.${token}`, email);
          if (branch_slug) window.localStorage.setItem("goloso.tablet.sede", branch_slug);
        }
        setMessage("Iniciando sesión…");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!cancelled) redirect(search, branch_slug);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Error inesperado");
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [token, search]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-emerald-50 to-white p-6">
      <img src={logoUrl} alt="Goloso" className="h-20 w-20" />
      <h1 className="text-xl font-semibold">Goloso Mesero</h1>
      {status === "loading" ? (
        <>
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
          <p className="text-sm text-muted-foreground">{message}</p>
        </>
      ) : (
        <>
          <p className="text-sm text-red-600 max-w-sm text-center">{message}</p>
          <button
            className="mt-2 rounded-md bg-emerald-600 px-4 py-2 text-white text-sm"
            onClick={() => window.location.reload()}
          >Reintentar</button>
        </>
      )}
    </div>
  );
}

function redirect(search: z.infer<typeof searchSchema>, branchSlug?: string | null) {
  const params = new URLSearchParams();
  const cachedSlug = branchSlug ?? (typeof window !== "undefined"
    ? window.localStorage.getItem("goloso.tablet.sede") : null);
  if (cachedSlug) params.set("sede", cachedSlug);
  params.set("src", search.src ?? "pwa");
  if (search.kiosk) params.set("kiosk", search.kiosk);
  window.location.replace(`/tablet-pedidos?${params.toString()}`);
}
