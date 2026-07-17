import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarClock } from "lucide-react";
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
    const label = `${selectedDay?.day} ${selectedDay?.month} · ${slot}`;
    onConfirm(utc.toISOString(), label);
    onOpenChange(false);
    setSlot(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Programa tu pedido
          </DialogTitle>
          <DialogDescription>
            Elige la fecha y la hora en la que quieres recibir tu pedido a domicilio.
          </DialogDescription>
        </DialogHeader>

        {days.length === 0 ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            En este momento no hay horarios disponibles para programar. Intenta más tarde.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">Fecha</div>
              <div className="grid grid-cols-4 gap-2">
                {days.slice(0, 8).map((d) => {
                  const active = (currentDateStr ?? days[0].dateStr) === d.dateStr;
                  return (
                    <button
                      key={d.dateStr}
                      type="button"
                      onClick={() => { setDateStr(d.dateStr); setSlot(null); }}
                      className={`rounded-lg border p-2 text-center transition ${active ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                    >
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{d.weekday}</div>
                      <div className="text-lg font-bold leading-none">{d.day}</div>
                      <div className="text-[10px] text-muted-foreground">{d.month}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">Hora disponible</div>
              <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto">
                {slots.map((s) => {
                  const active = s === slot;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSlot(s)}
                      className={`rounded-md border py-2 text-sm font-medium transition ${active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                    >
                      {s}
                    </button>
                  );
                })}
                {slots.length === 0 && (
                  <div className="col-span-4 text-xs text-muted-foreground text-center py-4">
                    Sin franjas disponibles para este día.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={!slot || !currentDateStr}>
            Confirmar programación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
