import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarClock, Clock, CalendarDays, Sparkles } from "lucide-react";
import {
  bogotaDateTimeToUTC,
  dayKeyForDate,
  getAvailableSlots,
  normalizeSchedules,
  toBogotaDateStr,
  type BranchSchedules,
  type ScheduleChannel,
} from "@/lib/schedules";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  schedules: BranchSchedules;
  channel: ScheduleChannel;
  onConfirm: (isoUtc: string, label: string) => void;
  minLeadMinutes?: number;
}

/** "14:30" -> "2:30 p. m." */
function to12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const suffix = h < 12 ? "a. m." : "p. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}


const DAY_LABEL: Record<string, string> = {
  lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom",
};
const MONTH_LABEL = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Genera hasta 14 días candidatos y descarta los que no tengan slots. */
function useCandidateDays(schedules: BranchSchedules, channel: ScheduleChannel, minLead: number) {
  return useMemo(() => {
    const s = normalizeSchedules(schedules);
    const out: Array<{ dateStr: string; label: string; day: number; month: string; weekday: string; slots: string[] }> = [];
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getTime() + i * 86_400_000);
      const dateStr = toBogotaDateStr(d);
      const slots = getAvailableSlots(s, channel, dateStr, { now, minLeadMinutes: minLead });
      if (slots.length === 0) continue;
      const probe = bogotaDateTimeToUTC(dateStr, "12:00");
      const dk = dayKeyForDate(probe);
      const [y, m, day] = dateStr.split("-").map(Number);
      out.push({
        dateStr,
        label: i === 0 ? "Hoy" : i === 1 ? "Mañana" : `${DAY_LABEL[dk]} ${day}`,
        day,
        month: MONTH_LABEL[m - 1],
        weekday: DAY_LABEL[dk],
        slots,
      });
      void y;
    }
    return out;
  }, [schedules, channel, minLead]);
}

export function ScheduleOrderDialog({ open, onOpenChange, schedules, channel, onConfirm, minLeadMinutes = 45 }: Props) {
  const days = useCandidateDays(schedules, channel, minLeadMinutes);
  const [dateStr, setDateStr] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);

  const selectedDay = days.find((d) => d.dateStr === dateStr) ?? days[0] ?? null;
  const currentDateStr = selectedDay?.dateStr ?? null;
  const slots = selectedDay?.slots ?? [];

  function handleConfirm() {
    if (!currentDateStr || !slot) return;
    const utc = bogotaDateTimeToUTC(currentDateStr, slot);
    const label = `${selectedDay?.day} ${selectedDay?.month} · ${to12h(slot)}`;
    onConfirm(utc.toISOString(), label);
    onOpenChange(false);
    setSlot(null);
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0 rounded-2xl border-primary/20 shadow-2xl">
        {/* Premium header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-rose-500 text-primary-foreground px-6 pt-6 pb-5">
          <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-amber-300/25 blur-2xl" />
          <DialogHeader className="relative space-y-2 text-left">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20 backdrop-blur ring-1 ring-white/30 shadow-lg">
                <CalendarClock className="h-6 w-6" />
              </div>
              <DialogTitle
                className="text-xl sm:text-2xl font-black tracking-wide uppercase leading-tight"
                style={{ fontFamily: '"Bebas Neue", "Fraunces Variable", sans-serif', letterSpacing: "0.06em" }}
              >
                📅 Programa tu pedido
              </DialogTitle>
            </div>
            <DialogDescription className="text-primary-foreground/90 text-sm leading-snug pl-14">
              Selecciona la fecha y la hora en la que deseas recibir o recoger tu pedido.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-5 py-5 bg-gradient-to-b from-white to-rose-50/30 dark:from-slate-950 dark:to-rose-950/10">
          {days.length === 0 ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
              En este momento no hay horarios disponibles para programar. Intenta más tarde.
            </div>
          ) : (
            <div className="space-y-5">
              {/* Fecha */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <div className="text-xs font-black uppercase tracking-widest text-foreground">Elige la fecha</div>
                </div>
                <div className="grid grid-cols-4 gap-2.5">
                  {days.slice(0, 8).map((d) => {
                    const active = (currentDateStr ?? days[0].dateStr) === d.dateStr;
                    return (
                      <button
                        key={d.dateStr}
                        type="button"
                        onClick={() => { setDateStr(d.dateStr); setSlot(null); }}
                        className={`group relative rounded-2xl border-2 p-2.5 text-center transition-all duration-200 active:scale-[0.96] ${
                          active
                            ? "border-primary bg-gradient-to-br from-primary to-rose-500 text-primary-foreground shadow-lg shadow-primary/30 scale-[1.03]"
                            : "border-border bg-white dark:bg-slate-900 hover:border-primary/40 hover:shadow-md text-foreground"
                        }`}
                      >
                        <div className={`text-[10px] font-bold uppercase tracking-widest ${active ? "text-primary-foreground/85" : "text-muted-foreground"}`}>
                          {d.weekday}
                        </div>
                        <div className="text-2xl font-black leading-none mt-0.5" style={{ fontFamily: '"Bebas Neue", sans-serif' }}>
                          {d.day}
                        </div>
                        <div className={`text-[10px] uppercase font-semibold mt-0.5 ${active ? "text-primary-foreground/85" : "text-muted-foreground"}`}>
                          {d.month}
                        </div>
                        {active && (
                          <Sparkles className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 text-amber-300 drop-shadow" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Hora */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="h-4 w-4 text-primary" />
                  <div className="text-xs font-black uppercase tracking-widest text-foreground">Hora disponible</div>
                  {slot && (
                    <span className="ml-auto text-[11px] font-bold uppercase tracking-wide text-primary bg-primary/10 rounded-full px-2 py-0.5">
                      {to12h(slot)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-60 overflow-y-auto pr-1">
                  {slots.map((s) => {
                    const active = s === slot;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSlot(s)}
                        className={`rounded-xl border-2 py-2.5 text-sm font-bold tabular-nums transition-all duration-150 active:scale-95 ${
                          active
                            ? "border-primary bg-gradient-to-br from-primary to-rose-500 text-primary-foreground shadow-lg shadow-primary/30 scale-[1.04]"
                            : "border-border bg-white dark:bg-slate-900 text-foreground hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
                        }`}
                      >
                        {to12h(s)}
                      </button>
                    );
                  })}
                  {slots.length === 0 && (
                    <div className="col-span-full text-xs text-muted-foreground text-center py-6">
                      Sin franjas disponibles para este día.
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          <DialogFooter className="mt-6 flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl h-11 font-semibold">
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!slot || !currentDateStr}
              className="rounded-xl h-11 font-bold uppercase tracking-wide bg-gradient-to-r from-primary to-rose-500 hover:from-primary hover:to-rose-600 shadow-lg shadow-primary/25 disabled:opacity-50"
            >
              Confirmar programación
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
