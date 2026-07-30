import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function isNewKey(k: string) { return k.startsWith("sb_publishable_") || k.startsWith("sb_secret_"); }

export const Route = createFileRoute("/api/public/tablet-auth/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = String(params.token ?? "").trim();
        if (!token || token.length < 16) {
          return new Response(JSON.stringify({ error: "invalid_token" }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key) {
          return new Response(JSON.stringify({ error: "server_misconfigured" }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        const supa = createClient<Database>(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
          global: {
            fetch: (input, init) => {
              const h = new Headers(init?.headers);
              if (isNewKey(key) && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
              h.set("apikey", key);
              return fetch(input, { ...init, headers: h });
            },
          },
        });
        const { data, error } = await supa.rpc("get_tablet_credentials", { _token: token });
        if (error) {
          return new Response(JSON.stringify({ error: "lookup_failed", detail: error.message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
          return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404, headers: { "Content-Type": "application/json" },
          });
        }
        // Nunca devolvemos la contraseña: iniciamos sesión aquí y entregamos
        // solo los tokens de sesión (de vida limitada y revocables).
        const { data: signIn, error: signInError } = await supa.auth.signInWithPassword({
          email: row.email,
          password: row.password,
        });
        if (signInError || !signIn.session) {
          return new Response(JSON.stringify({ error: "sign_in_failed" }), {
            status: 401, headers: { "Content-Type": "application/json" },
          });
        }
        // best-effort touch (ignore errors)
        void supa.rpc("touch_tablet_last_seen", { _token: token });
        return new Response(JSON.stringify({
          email: row.email,
          branch_slug: row.branch_slug,
          branch_name: row.branch_name,
          access_token: signIn.session.access_token,
          refresh_token: signIn.session.refresh_token,
        }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

      },
    },
  },
});
