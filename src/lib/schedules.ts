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

function emptyChannel(): ChannelSchedule {
  return {
    lun: { ...DEFAULT_DAY }, mar: { ...DEFAULT_DAY }, mie: { ...DEFAULT_DAY },
    jue: { ...DEFAULT_DAY }, vie: { ...DEFAULT_DAY }, sab: { ...DEFAULT_DAY }, dom: { ...DEFAULT_DAY },
  };
}

export function normalizeSchedules(raw: unknown): BranchSchedules {
  const r = (raw ?? {}) as Partial<BranchSchedules>;
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
  return { physical: norm(r.physical), online: norm(r.online) };
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
}

export function getChannelStatus(
  schedules: BranchSchedules,
  channel: ScheduleChannel,
  now: Date = new Date(),
): ChannelStatus {
  const s = normalizeSchedules(schedules);
  const ch = s[channel];
  const { day, minutes } = bogotaParts(now);
  const today = ch[day];
  if (!today || !today.open) {
    return { isOpen: false, reason: "closed_day", closesAt: null, opensAt: null, minutesToClose: null };
  }
  const from = toMinutes(today.from);
  const to = toMinutes(today.to);
  if (minutes < from) {
    return { isOpen: false, reason: "before_open", closesAt: null, opensAt: today.from, minutesToClose: null };
  }
  if (minutes >= to) {
    return { isOpen: false, reason: "after_close", closesAt: today.to, opensAt: null, minutesToClose: null };
  }
  return { isOpen: true, reason: "open", closesAt: today.to, opensAt: null, minutesToClose: to - minutes };
}

export function humanReason(status: ChannelStatus, channel: ScheduleChannel): string {
  const label = channel === "physical" ? "atención en el punto físico" : "pedidos en línea";
  if (status.isOpen) return `Abierto — cierra a las ${status.closesAt}`;
  if (status.reason === "closed_day") return `Hoy no hay ${label}.`;
  if (status.reason === "before_open") return `Los ${label} inician a las ${status.opensAt}.`;
  if (channel === "physical") {
    return "El horario de atención en el punto físico ha finalizado. No es posible registrar nuevos pedidos.";
  }
  return "Estamos fuera del horario para pedidos en línea.";
}

export { DEFAULT_DAY };
