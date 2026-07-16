import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function envValue(primary: string, fallback: string) {
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const viteEnv = import.meta.env as Record<string, string | undefined>;
  return processEnv?.[primary] ?? processEnv?.[fallback] ?? viteEnv[primary] ?? viteEnv[fallback];
}

function isOpaqueSupabaseKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createBackendFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (isOpaqueSupabaseKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

export const requireLovableCloudAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const backendUrl = envValue("SUPABASE_URL", "VITE_SUPABASE_URL");
  const publishableKey = envValue("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY");

  if (!backendUrl || !publishableKey) {
    throw new Error("No se encontró la configuración del backend para validar la sesión");
  }

  const request = getRequest();
  const authHeader = request?.headers?.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Tu sesión no está activa. Vuelve a iniciar sesión e intenta de nuevo.");
  }

  const token = authHeader.replace("Bearer ", "");
  if (!token || token.split(".").length !== 3) {
    throw new Error("Tu sesión no es válida. Vuelve a iniciar sesión e intenta de nuevo.");
  }

  const supabase = createClient<Database>(backendUrl, publishableKey, {
    global: {
      fetch: createBackendFetch(publishableKey),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    throw new Error("Tu sesión no es válida. Vuelve a iniciar sesión e intenta de nuevo.");
  }

  return next({
    context: {
      supabase,
      userId: data.claims.sub,
      claims: data.claims,
    },
  });
});