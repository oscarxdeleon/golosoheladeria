export const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export const formatMoney = (n: number | string | null | undefined) => {
  const v = typeof n === "string" ? Number(n) : (n ?? 0);
  return COP.format(Number.isFinite(v) ? v : 0);
};

export const formatDate = (d: string | Date | null | undefined) => {
  // Nunca renderizar "31/12/69": `new Date(null)` = epoch 0 y en zona horaria
  // de Colombia (UTC-5) queda como 31/12/1969 7:00 p.m. Cuando el valor llega
  // vacío, cero o inválido, mostramos un guion en lugar de una fecha
  // inventada que enmascara datos corruptos.
  if (d === null || d === undefined || d === "") return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = date instanceof Date ? date.getTime() : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
};

// Etiquetas oficiales de estado de venta (siempre en español, "Anulado" para cancelled).
const SALE_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "En preparación",
  ready: "Listo",
  paid: "Pagado",
  delivered: "Entregado",
  cancelled: "Anulado",
};

export function translateSaleStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return SALE_STATUS_LABELS[status] ?? status;
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  mesa: "Mesa",
  llevar: "Para llevar",
  domicilio: "Domicilio",
  kiosko: "Autopedido",
  online: "En línea",
};

export function translateOrderType(type: string | null | undefined): string {
  if (!type) return "—";
  return ORDER_TYPE_LABELS[type] ?? type;
}
