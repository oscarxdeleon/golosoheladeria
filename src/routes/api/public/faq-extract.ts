import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { extractFaqs } from "@/lib/whatsapp-faq-import.functions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/public/faq-extract")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("Authorization") ?? "";
          const token = authHeader.replace(/^Bearer\s+/i, "").trim();
          if (!token) return Response.json({ error: "No autenticado" }, { status: 401, headers: CORS });

          const url = process.env.SUPABASE_URL!;
          const anon = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const supa = createClient(url, anon, {
            global: {
              fetch: (input, init) => {
                const h = new Headers(init?.headers);
                if (anon.startsWith("sb_") && h.get("Authorization") === `Bearer ${anon}`) h.delete("Authorization");
                h.set("apikey", anon);
                h.set("Authorization", `Bearer ${token}`);
                return fetch(input, { ...init, headers: h });
              },
            },
            auth: { persistSession: false },
          });
          const { data: userRes, error: userErr } = await supa.auth.getUser(token);
          if (userErr || !userRes?.user) {
            return Response.json({ error: "Token inválido" }, { status: 401, headers: CORS });
          }

          const body = (await request.json().catch(() => ({}))) as { text?: string; branchId?: string };
          const text = typeof body.text === "string" ? body.text.slice(0, 200_000) : "";
          const branchId = typeof body.branchId === "string" ? body.branchId : "";
          if (!text || !branchId) {
            return Response.json({ error: "Faltan datos (text, branchId)" }, { status: 400, headers: CORS });
          }

          const result = await extractFaqs(text);
          return Response.json(result, { headers: CORS });
        } catch (err) {
          return Response.json({ error: (err as Error).message }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
