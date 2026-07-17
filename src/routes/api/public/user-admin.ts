import { createFileRoute } from "@tanstack/react-router";

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

function normalizeBackendError(body: unknown, fallback: string) {
  const cleanText = (value: string) => {
    const text = value.trim();
    if (!text) return fallback;

    if (/JWT|token|authorization|bearer/i.test(text)) {
      return "Tu sesión no está activa. Vuelve a iniciar sesión e intenta de nuevo.";
    }

    if (/^\s*<!doctype html|^\s*<html/i.test(text)) {
      return "El servidor devolvió una página de error en lugar de una respuesta válida. Recarga la app e intenta de nuevo.";
    }

    return text;
  };

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    return cleanText(String(record.message ?? record.details ?? record.hint ?? record.error ?? fallback));
  }

  return cleanText(String(body || ""));
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
            return jsonResponse({ error: normalizeBackendError(parsed, "No se pudo completar la operación de usuarios") }, response.status);
          }

          return jsonResponse({ data: parsed ?? null });
        } catch (error) {
          return jsonResponse({
            error: normalizeBackendError(error instanceof Error ? error.message : error, "No se pudo completar la operación de usuarios"),
          }, 500);
        }
      },
    },
  },
});