import { createFileRoute } from "@tanstack/react-router";
import { normalizeUserAdminError } from "@/lib/user-admin-errors";

type UserAdminRpcName = "admin_create_app_user" | "admin_update_app_user" | "admin_delete_app_user";

const ALLOWED_ACTIONS = new Set<UserAdminRpcName>([
  "admin_create_app_user",
  "admin_update_app_user",
  "admin_delete_app_user",
]);

function getBackendConfig() {
  const backendUrl = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!backendUrl || !publishableKey) {
    throw new Error("La configuración del backend no está disponible. Publica/recarga la app e intenta nuevamente.");
  }

  return {
    backendUrl: backendUrl.replace(/\/$/, ""),
    publishableKey,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/public/user-admin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization") ?? "";
          if (!authHeader.startsWith("Bearer ")) {
            return jsonResponse({ error: "Tu sesión no está activa. Vuelve a iniciar sesión e intenta de nuevo." }, 401);
          }

          const input = await request.json().catch(() => null) as {
            action?: UserAdminRpcName;
            payload?: Record<string, unknown>;
          } | null;

          const action = input?.action;
          if (!action || !ALLOWED_ACTIONS.has(action)) {
            return jsonResponse({ error: "Operación de usuarios no permitida." }, 400);
          }

          const { backendUrl, publishableKey } = getBackendConfig();
           const userResponse = await fetch(`${backendUrl}/auth/v1/user`, {
             headers: { apikey: publishableKey, Authorization: authHeader },
           });
           const user = await userResponse.json().catch(() => null) as { id?: string } | null;
           if (!userResponse.ok || !user?.id) {
             return jsonResponse({ error: "Tu sesión no es válida." }, 401);
           }

           const roleResponse = await fetch(`${backendUrl}/rest/v1/rpc/has_role`, {
             method: "POST",
             headers: {
               apikey: publishableKey,
               Authorization: authHeader,
               "Content-Type": "application/json",
             },
             body: JSON.stringify({ _user_id: user.id, _role: "admin" }),
           });
           const isAdmin = await roleResponse.json().catch(() => false);
           if (!roleResponse.ok || isAdmin !== true) {
             return jsonResponse({ error: "Solo un administrador puede gestionar usuarios." }, 403);
           }

          const response = await fetch(`${backendUrl}/rest/v1/rpc/${action}`, {
            method: "POST",
            headers: {
              apikey: publishableKey,
              Authorization: authHeader,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(input?.payload ?? {}),
          });

          const raw = await response.text();
          let parsed: unknown = raw;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = raw;
            }
          }

          if (!response.ok) {
            return jsonResponse({ error: normalizeUserAdminError(parsed, "No se pudo completar la operación de usuarios") }, response.status);
          }

          return jsonResponse({ data: parsed ?? null });
        } catch (error) {
          return jsonResponse({
            error: normalizeUserAdminError(error, "No se pudo completar la operación de usuarios"),
          }, 500);
        }
      },
    },
  },
});