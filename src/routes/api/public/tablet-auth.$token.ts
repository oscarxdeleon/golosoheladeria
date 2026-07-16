import { createFileRoute } from "@tanstack/react-router";

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
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("tablet_devices")
          .select("email, password, active, branch_id, branches:branch_id(slug, name)")
          .eq("token", token)
          .maybeSingle();
        if (error || !data || !data.active) {
          return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404, headers: { "Content-Type": "application/json" },
          });
        }
        // best-effort update last_seen
        await supabaseAdmin.from("tablet_devices").update({ last_seen_at: new Date().toISOString() }).eq("token", token);
        const branch = Array.isArray(data.branches) ? data.branches[0] : data.branches;
        return new Response(JSON.stringify({
          email: data.email,
          password: data.password,
          branch_slug: branch?.slug ?? null,
          branch_name: branch?.name ?? null,
        }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      },
    },
  },
});
