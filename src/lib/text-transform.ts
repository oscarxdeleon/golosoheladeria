/**
 * Convierte texto a MAYÚSCULAS preservando tildes, Ñ, números y símbolos.
 * Usa el locale español para asegurar el comportamiento correcto de caracteres
 * como "ß" o casos regionales.
 */
export function toUpperText(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value).toLocaleUpperCase("es");
}

/** Solo dígitos (para teléfonos / WhatsApp) */
export function onlyDigits(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value).replace(/\D+/g, "");
}
