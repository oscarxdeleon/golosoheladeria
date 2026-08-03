import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DeployResult = {
  ok: boolean;
  status: "success" | "error";
  code: string;
  message: string;
  http_status: number | null;
  job_id: string | null;
  build_url: string | null;
  duration_ms: number;
  source: "database" | "env";
};

export type DeployConfigInfo = {
  configured: boolean;
  source: "database" | "env" | null;
  masked_url: string | null;
  updated_at: string | null;
};

const HOOK_RE = /^https:\/\/api\.vercel\.com\/v\d+\/integrations\/deploy\/prj_[A-Za-z0-9]+\/[A-Za-z0-9]+$/;

function mask(url: string) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    const last = parts.pop() ?? "";
    return `${u.origin}${parts.join("/")}/${last.slice(0, 3)}••••`;
  } catch {
    return "URL no válida";
  }
}

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(`No se pudo verificar el rol de administrador: ${error.message}`);
  if (!isAdmin) throw new Error("Solo los administradores pueden desplegar en Vercel.");
}

/**
 * Causa raíz del fallo original: el hook vivía únicamente como variable de
 * entorno de Lovable Cloud. En el despliegue de Vercel esa variable no existe,
 * así que `process.env.VERCEL_DEPLOY_HOOK` era `undefined` y el botón fallaba.
 * Ahora el hook se guarda en la base de datos (compartida por ambos entornos)
 * y la variable de entorno queda solo como respaldo.
 */
async function resolveHook(supabase: any): Promise<{ url: string; source: "database" | "env" } | null> {
  const { data } = await supabase
    .from("app_deploy_config")
    .select("hook_url")
    .eq("provider", "vercel")
    .maybeSingle();
  const dbUrl = (data as { hook_url?: string } | null)?.hook_url?.trim();
  if (dbUrl) return { url: dbUrl, source: "database" };
  const envUrl = process.env["VERCEL_DEPLOY_HOOK"]?.trim();
  if (envUrl) return { url: envUrl, source: "env" };
  return null;
}

export const getDeployConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeployConfigInfo> => {
    await requireAdmin(context as any);
    const { supabase } = context as any;
    const { data } = await supabase
      .from("app_deploy_config")
      .select("hook_url, updated_at")
      .eq("provider", "vercel")
      .maybeSingle();
    const row = data as { hook_url?: string; updated_at?: string } | null;
    if (row?.hook_url) {
      return {
        configured: true,
        source: "database",
        masked_url: mask(row.hook_url),
        updated_at: row.updated_at ?? null,
      };
    }
    const envUrl = process.env["VERCEL_DEPLOY_HOOK"]?.trim();
    return {
      configured: !!envUrl,
      source: envUrl ? "env" : null,
      masked_url: envUrl ? mask(envUrl) : null,
      updated_at: null,
    };
  });

export const saveDeployHook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { hookUrl: string }) => {
    const hookUrl = String(input?.hookUrl ?? "").trim();
    if (!HOOK_RE.test(hookUrl)) {
      throw new Error(
        "La URL no parece un Deploy Hook de Vercel. Debe tener el formato https://api.vercel.com/v1/integrations/deploy/prj_.../clave",
      );
    }
    return { hookUrl };
  })
  .handler(async ({ data, context }) => {
    await requireAdmin(context as any);
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("app_deploy_config")
      .upsert(
        { provider: "vercel", hook_url: data.hookUrl, updated_at: new Date().toISOString(), updated_by: userId },
        { onConflict: "provider" },
      );
    if (error) throw new Error(`No se pudo guardar el Deploy Hook: ${error.message}`);
    return { ok: true as const, masked_url: mask(data.hookUrl) };
  });

export const deployToVercel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeployResult> => {
    await requireAdmin(context as any);
    const { supabase, userId } = context as any;
    const startedAt = Date.now();

    const log = async (result: DeployResult) => {
      await supabase.from("app_deploy_log").insert({
        provider: "vercel",
        status: result.status,
        message: `${result.code}: ${result.message}`,
        http_status: result.http_status,
        duration_ms: result.duration_ms,
        job_id: result.job_id,
        build_url: result.build_url,
        triggered_by: userId,
      });
      return result;
    };

    const hook = await resolveHook(supabase);
    if (!hook) {
      return log({
        ok: false,
        status: "error",
        code: "HOOK_NO_CONFIGURADO",
        message:
          "No existe un Deploy Hook de Vercel guardado. Créalo en Vercel (Settings → Git → Deploy Hooks) y pégalo en este mismo panel.",
        http_status: null,
        job_id: null,
        build_url: null,
        duration_ms: Date.now() - startedAt,
        source: "database",
      });
    }

    if (!HOOK_RE.test(hook.url)) {
      return log({
        ok: false,
        status: "error",
        code: "HOOK_INVALIDO",
        message: "El Deploy Hook configurado no tiene un formato válido de Vercel. Vuelve a generarlo y guárdalo.",
        http_status: null,
        job_id: null,
        build_url: null,
        duration_ms: Date.now() - startedAt,
        source: hook.source,
      });
    }

    let res: Response;
    try {
      res = await fetch(hook.url, { method: "POST", signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      return log({
        ok: false,
        status: "error",
        code: "SIN_CONEXION",
        message: `No fue posible conectarse con Vercel: ${
          error instanceof Error ? error.message.slice(0, 160) : "error de red"
        }`,
        http_status: null,
        job_id: null,
        build_url: null,
        duration_ms: Date.now() - startedAt,
        source: hook.source,
      });
    }

    const text = await res.text().catch(() => "");
    let payload: any = null;
    try {
      payload = JSON.parse(text);
    } catch {
      /* respuesta no JSON */
    }

    if (!res.ok) {
      const code =
        res.status === 401 || res.status === 403
          ? "AUTENTICACION"
          : res.status === 404
            ? "PROYECTO_NO_ENCONTRADO"
            : res.status === 429
              ? "LIMITE_ALCANZADO"
              : "ERROR_VERCEL";
      const detail = payload?.error?.message ?? text.slice(0, 200);
      const messages: Record<string, string> = {
        AUTENTICACION: "Error de autenticación con Vercel: el Deploy Hook fue revocado o ya no es válido. Genera uno nuevo y guárdalo aquí.",
        PROYECTO_NO_ENCONTRADO: "El proyecto de Vercel del Deploy Hook no existe o fue eliminado. Genera un hook nuevo desde el proyecto correcto.",
        LIMITE_ALCANZADO: "Vercel rechazó la solicitud por exceso de despliegues. Espera unos minutos e inténtalo de nuevo.",
        ERROR_VERCEL: `Vercel respondió con un error (HTTP ${res.status}).`,
      };
      return log({
        ok: false,
        status: "error",
        code,
        message: `${messages[code]}${detail ? ` Detalle: ${detail}` : ""}`,
        http_status: res.status,
        job_id: null,
        build_url: null,
        duration_ms: Date.now() - startedAt,
        source: hook.source,
      });
    }

    const jobId: string | null = payload?.job?.id ?? null;
    return log({
      ok: true,
      status: "success",
      code: "DESPLIEGUE_INICIADO",
      message:
        "Despliegue iniciado correctamente en Vercel. El build tarda 1–3 minutos en publicarse; los cambios aparecerán al terminar.",
      http_status: res.status,
      job_id: jobId,
      build_url: "https://vercel.com/dashboard",
      duration_ms: Date.now() - startedAt,
      source: hook.source,
    });
  });
