// Horarios de sede por canal (punto físico / menú en línea).
// Zona horaria: America/Bogota (fuente única de verdad).

export type ScheduleChannel = "physical" | "online";
export type DayKey = "lun" | "mar" | "mie" | "jue" | "vie" | "sab" | "dom";

export interface DaySchedule {
  open: boolean;
  from: string; // "HH:MM"
  to: string;   // "HH:MM"
}

export type ChannelSchedule = Record<DayKey, DaySchedule>;

export interface BranchSchedules {
  physical: ChannelSchedule;
  online: ChannelSchedule;
  /** Minutos adicionales tras el cierre oficial en los que SÍ se permiten nuevos pedidos. Aplica a ambos canales. Default 15. */
  salesGraceMinutes: number;
  /** Minutos administrativos tras terminar la gracia de ventas (solo canal físico). NO permite nuevos pedidos, sí tareas admin. Default 30. */
  adminGraceMinutes: number;
}

const DAY_ORDER: DayKey[] = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
export const DAYS: Array<{ key: DayKey; label: string }> = [
  { key: "lun", label: "Lunes" },
  { key: "mar", label: "Martes" },
  { key: "mie", label: "Miércoles" },
  { key: "jue", label: "Jueves" },
  { key: "vie", label: "Viernes" },
  { key: "sab", label: "Sábado" },
  { key: "dom", label: "Domingo" },
];

const DEFAULT_DAY: DaySchedule = { open: true, from: "10:00", to: "22:00" };
export const DEFAULT_SALES_GRACE_MINUTES = 15;
export const DEFAULT_ADMIN_GRACE_MINUTES = 30;

function emptyChannel(): ChannelSchedule {
  return {
    lun: { ...DEFAULT_DAY }, mar: { ...DEFAULT_DAY }, mie: { ...DEFAULT_DAY },
    jue: { ...DEFAULT_DAY }, vie: { ...DEFAULT_DAY }, sab: { ...DEFAULT_DAY }, dom: { ...DEFAULT_DAY },
  };
}

function clampInt(v: unknown, def: number, min = 0, max = 240): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function normalizeSchedules(raw: unknown): BranchSchedules {
  const r = (raw ?? {}) as Partial<BranchSchedules> & Record<string, unknown>;
  const norm = (c: unknown): ChannelSchedule => {
    const src = (c ?? {}) as Partial<ChannelSchedule>;
    const out = emptyChannel();
    for (const d of DAY_ORDER) {
      const day = (src as Record<string, unknown>)[d] as Partial<DaySchedule> | undefined;
      if (day && typeof day === "object") {
        out[d] = {
          open: day.open !== false,
          from: typeof day.from === "string" ? day.from : "10:00",
          to: typeof day.to === "string" ? day.to : "22:00",
        };
      }
    }
    return out;
  };
  return {
    physical: norm(r.physical),
    online: norm(r.online),
    salesGraceMinutes: clampInt(r.salesGraceMinutes, DEFAULT_SALES_GRACE_MINUTES),
    adminGraceMinutes: clampInt(r.adminGraceMinutes, DEFAULT_ADMIN_GRACE_MINUTES),
  };
}

/** Componentes locales (Colombia) del instante `now`. */
function bogotaParts(now: Date = new Date()): { day: DayKey; minutes: number; hhmm: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const wk = (parts.find((p) => p.type === "weekday")?.value ?? "Mon").toLowerCase();
  const map: Record<string, DayKey> = {
    sun: "dom", mon: "lun", tue: "mar", wed: "mie", thu: "jue", fri: "vie", sat: "sab",
  };
  const day = map[wk] ?? "lun";
  let hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  if (hh === 24) hh = 0;
  return { day, minutes: hh * 60 + mm, hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return (h || 0) * 60 + (m || 0);
}

export interface ChannelStatus {
  isOpen: boolean;
  /** Motivo cuando está cerrado. */
  reason: "open" | "closed_day" | "before_open" | "after_close";
  /** Hora de cierre de hoy (HH:MM) si está abierto. */
  closesAt: string | null;
  /** Hora de apertura de hoy (HH:MM) si aún no abrió. */
  opensAt: string | null;
  /** Minutos restantes hasta el cierre (si isOpen). */
  minutesToClose: number | null;
  /** Estamos dentro del período de gracia (30 min tras el cierre oficial). */
  inGracePeriod: boolean;
  /** Minutos restantes del período de gracia (solo si inGracePeriod). */
  minutesToGraceEnd: number | null;
  /** Hora fin del período de gracia (HH:MM) — solo canal físico. */
  graceEndsAt: string | null;
}

/**
 * Período de gracia (minutos) tras el cierre oficial del punto físico.
 * En esta ventana el sistema NO permite nuevos pedidos, pero SÍ permite tareas
 * administrativas (cierre de caja, reportes, arqueos, revisión de pedidos existentes).
 * Solo aplica al canal físico; el canal online no tiene gracia.
 */
export const PHYSICAL_GRACE_MINUTES = 30;

export function getChannelStatus(
  schedules: BranchSchedules,
  channel: ScheduleChannel,
  now: Date = new Date(),
): ChannelStatus {
  const s = normalizeSchedules(schedules);
  const ch = s[channel];
  const { day, minutes } = bogotaParts(now);
  const today = ch[day];
  const base = { inGracePeriod: false, minutesToGraceEnd: null, graceEndsAt: null } as const;
  if (!today || !today.open) {
    return { isOpen: false, reason: "closed_day", closesAt: null, opensAt: null, minutesToClose: null, ...base };
  }
  const from = toMinutes(today.from);
  const to = toMinutes(today.to);
  if (minutes < from) {
    return { isOpen: false, reason: "before_open", closesAt: null, opensAt: today.from, minutesToClose: null, ...base };
  }
  if (minutes >= to) {
    const grace = channel === "physical" ? PHYSICAL_GRACE_MINUTES : 0;
    const graceEnd = to + grace;
    if (grace > 0 && minutes < graceEnd) {
      const gh = Math.floor(graceEnd / 60) % 24;
      const gm = graceEnd % 60;
      const graceEndsAt = `${String(gh).padStart(2, "0")}:${String(gm).padStart(2, "0")}`;
      return {
        isOpen: false,
        reason: "after_close",
        closesAt: today.to,
        opensAt: null,
        minutesToClose: null,
        inGracePeriod: true,
        minutesToGraceEnd: graceEnd - minutes,
        graceEndsAt,
      };
    }
    return { isOpen: false, reason: "after_close", closesAt: today.to, opensAt: null, minutesToClose: null, ...base };
  }
  return { isOpen: true, reason: "open", closesAt: today.to, opensAt: null, minutesToClose: to - minutes, ...base };
}

export function humanReason(status: ChannelStatus, channel: ScheduleChannel): string {
  const label = channel === "physical" ? "atención en el punto físico" : "pedidos en línea";
  if (status.isOpen) return `Abierto — cierra a las ${status.closesAt}`;
  if (status.reason === "closed_day") return `Hoy no hay ${label}.`;
  if (status.reason === "before_open") return `Los ${label} inician a las ${status.opensAt}.`;
  if (channel === "physical") {
    if (status.inGracePeriod) {
      return `Horario oficial finalizado. Período de gracia hasta ${status.graceEndsAt} (${status.minutesToGraceEnd} min) para tareas administrativas. No se aceptan nuevos pedidos.`;
    }
    return "El horario de atención en el punto físico ha finalizado. No es posible registrar nuevos pedidos.";
  }
  return "Estamos fuera del horario para pedidos en línea.";
}


export { DEFAULT_DAY };

/** Devuelve el DayKey correspondiente a una fecha (en zona Bogotá). */
export function dayKeyForDate(date: Date): DayKey {
  const wk = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
  }).format(date).toLowerCase();
  const map: Record<string, DayKey> = {
    sun: "dom", mon: "lun", tue: "mar", wed: "mie", thu: "jue", fri: "vie", sat: "sab",
  };
  return map[wk] ?? "lun";
}

/** yyyy-mm-dd en zona Bogotá. */
export function toBogotaDateStr(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const y = parts.find(p => p.type === "year")?.value ?? "1970";
  const m = parts.find(p => p.type === "month")?.value ?? "01";
  const d = parts.find(p => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * Convierte "YYYY-MM-DD" + "HH:MM" (interpretados en Bogotá, UTC-05, sin DST)
 * a una fecha absoluta (ISO/Date en UTC).
 */
export function bogotaDateTimeToUTC(dateStr: string, hhmm: string): Date {
  return new Date(`${dateStr}T${hhmm}:00-05:00`);
}

/**
 * Genera franjas horarias disponibles para un canal, en un día concreto.
 * - stepMinutes: separación entre franjas (default 30).
 * - minLeadMinutes: tiempo mínimo de preparación respecto a "now" (default 45).
 * - lastSlotBeforeCloseMinutes: cuánto antes del cierre se corta (default 30).
 */
export function getAvailableSlots(
  schedules: BranchSchedules,
  channel: ScheduleChannel,
  dateStr: string,
  opts: { now?: Date; stepMinutes?: number; minLeadMinutes?: number; lastSlotBeforeCloseMinutes?: number } = {},
): string[] {
  const step = opts.stepMinutes ?? 30;
  const lead = opts.minLeadMinutes ?? 45;
  const tail = opts.lastSlotBeforeCloseMinutes ?? 30;
  const now = opts.now ?? new Date();

  const s = normalizeSchedules(schedules);
  // "YYYY-MM-DD" -> día de la semana en Bogotá:
  const probe = bogotaDateTimeToUTC(dateStr, "12:00");
  const day = dayKeyForDate(probe);
  const cfg = s[channel][day];
  if (!cfg || !cfg.open) return [];

  const from = toMinutes(cfg.from);
  const to = toMinutes(cfg.to) - tail;
  if (to <= from) return [];

  const todayStr = toBogotaDateStr(now);
  const nowMinutes = todayStr === dateStr ? bogotaParts(now).minutes + lead : -1;

  const out: string[] = [];
  for (let m = from; m <= to; m += step) {
    if (m < nowMinutes) continue;
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

