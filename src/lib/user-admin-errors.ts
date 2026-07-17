const DEFAULT_USER_ADMIN_ERROR = "No se pudo completar la operación de usuarios";

function messageFromObject(value: Record<string, unknown>): unknown {
  const direct = value.error ?? value.message ?? value.details ?? value.hint ?? value.msg;
  if (direct && typeof direct === "object") return messageFromObject(direct as Record<string, unknown>);
  return direct;
}

function cleanUserAdminErrorText(value: string, fallback: string) {
  const text = value.trim();
  if (!text || text === "[object Object]") return fallback;

  if (/Ya existe|already registered|duplicate key|users_email_partial_key|identities_provider_id_provider_unique/i.test(text)) {
    return "Ya existe un usuario con ese correo";
  }

  if (/Failed to fetch|NetworkError|Load failed|fetch failed|ECONN|timeout/i.test(text)) {
    return "Error de conexión";
  }

  if (/permission denied|not authorized|forbidden|Solo administradores|supervisores/i.test(text)) {
    return "No tienes permisos suficientes";
  }

  if (/JWT|token|authorization|bearer/i.test(text)) {
    return "Tu sesión no está activa. Vuelve a iniciar sesión e intenta de nuevo.";
  }

  if (/^\s*<!doctype html|^\s*<html/i.test(text)) {
    return "El servidor devolvió una página de error. Recarga la pantalla de usuarios e intenta nuevamente.";
  }

  return text;
}

export function normalizeUserAdminError(error: unknown, fallback = DEFAULT_USER_ADMIN_ERROR) {
  if (error instanceof Error) {
    return cleanUserAdminErrorText(error.message, fallback);
  }

  if (error && typeof error === "object") {
    const extracted = messageFromObject(error as Record<string, unknown>);
    return cleanUserAdminErrorText(typeof extracted === "string" ? extracted : fallback, fallback);
  }

  return cleanUserAdminErrorText(String(error || ""), fallback);
}