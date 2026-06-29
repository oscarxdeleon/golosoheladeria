import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScanFace, LogIn, LogOut, Coffee, Play, Search, MapPin, CheckCircle2, Delete, KeyRound } from "lucide-react";
import { SmartFaceVerifier } from "@/components/attendance/smart-face-verifier";
import { loadFaceModels } from "@/lib/face-api-loader";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/asistencia/terminal/$slug")({
  head: ({ params }) => ({ meta: [{ title: `Terminal ${params.slug} · Asistencia` }] }),
  component: TerminalPage,
});

type Employee = {
  id: string;
  full_name: string;
  job_position: string | null;
  photo_url: string | null;
  face_descriptor: number[] | null;
  document_id: string | null;
  terminal_id: string;
  terminal_name: string;
};

const TYPE_OPTIONS = [
  { key: "entrada", label: "Entrada", icon: LogIn, color: "bg-emerald-500" },
  { key: "salida", label: "Salida", icon: LogOut, color: "bg-rose-500" },
  { key: "pausa_inicio", label: "Inicio pausa", icon: Coffee, color: "bg-amber-500" },
  { key: "pausa_fin", label: "Fin pausa", icon: Play, color: "bg-blue-500" },
];

function TerminalPage() {
  const { slug } = useParams({ from: "/asistencia/terminal/$slug" });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Employee | null>(null);
  const [step, setStep] = useState<"list" | "type" | "verify" | "pin" | "done">("list");
  const [recordType, setRecordType] = useState<string>("");
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [doneInfo, setDoneInfo] = useState<{ name: string; type: string; time: string; photo: string | null } | null>(null);
  const [pinValue, setPinValue] = useState("");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Preload face models as soon as the terminal mounts so the cache is warm
    loadFaceModels().catch(() => {});
    (async () => {
      try {
        const { data, error } = await supabase.rpc("terminal_list_employees", { _slug: slug });
        if (error) throw error;
        setEmployees((data ?? []) as Employee[]);
      } catch (e: any) {
        setError(e.message || "Error al cargar terminal");
      } finally { setLoading(false); }
    })();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 60000 }
      );
    }
  }, [slug]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (!s) return employees;
    return employees.filter(e =>
      e.full_name.toLowerCase().includes(s) ||
      (e.job_position ?? "").toLowerCase().includes(s) ||
      (e.document_id ?? "").includes(s)
    );
  }, [employees, search]);

  function reset() {
    if (resetTimer.current) { clearTimeout(resetTimer.current); resetTimer.current = null; }
    setSelected(null); setStep("list"); setRecordType(""); setDoneInfo(null); setSearch(""); setPinValue("");
  }

  async function persistRecord(blob: Blob | null, score: number | null, employeeId: string, method: "face" | "pin") {
    let signedUrl = "";
    if (blob) {
      const path = `records/${Date.now()}-${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("attendance").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("attendance").createSignedUrl(path, 60 * 60 * 24 * 365);
      signedUrl = signed?.signedUrl ?? "";
    }
    const { data, error } = await supabase.rpc("terminal_record_attendance", {
      _payload: {
        terminal_slug: slug,
        employee_id: employeeId,
        record_type: recordType,
        lat: position?.lat?.toString() ?? "",
        lng: position?.lng?.toString() ?? "",
        address: "",
        photo_url: signedUrl,
        face_match_score: score?.toString() ?? "",
        device_info: { ua: navigator.userAgent, method },
      },
    });
    if (error) throw error;
    return data as { employee_name: string; record_type: string; recorded_at: string };
  }

  async function handleFaceMatch(blob: Blob, _dataUrl: string, score: number | null) {
    if (!selected) return;
    try {
      const info = await persistRecord(blob, score, selected.id, "face");
      setDoneInfo({
        name: info.employee_name,
        type: info.record_type,
        time: format(new Date(info.recorded_at), "HH:mm:ss"),
        photo: selected.photo_url,
      });
      setStep("done");
      resetTimer.current = setTimeout(reset, 4000);
    } catch (e: any) {
      toast.error(e.message || "Error al registrar marcación");
      throw e;
    }
  }

  async function handlePinSubmit() {
    if (!selected) return;
    if (!pinValue.trim()) return;
    if ((selected.document_id ?? "").trim() !== pinValue.trim()) {
      toast.error("Cédula / PIN incorrecto");
      return;
    }
    try {
      const info = await persistRecord(null, null, selected.id, "pin");
      setDoneInfo({
        name: info.employee_name,
        type: info.record_type,
        time: format(new Date(info.recorded_at), "HH:mm:ss"),
        photo: selected.photo_url,
      });
      setStep("done");
      resetTimer.current = setTimeout(reset, 4000);
    } catch (e: any) {
      toast.error(e.message || "Error al registrar marcación");
    }
  }

  function pressKey(k: string) {
    if (k === "back") setPinValue(v => v.slice(0, -1));
    else if (k === "clear") setPinValue("");
    else setPinValue(v => (v + k).slice(0, 20));
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Cargando terminal…</div>;
  if (error) return <div className="flex min-h-screen items-center justify-center text-rose-500">{error}</div>;
  const terminalName = employees[0]?.terminal_name ?? "Terminal de Asistencia";

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-primary/5 via-background to-pink-500/5">
      <header className="border-b bg-background/70 backdrop-blur">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-2">
            <ScanFace className="h-6 w-6 text-primary" />
            <div>
              <h1 className="font-display text-lg font-semibold leading-tight">{terminalName}</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {position ? <><MapPin className="h-3 w-3" /> {position.lat.toFixed(4)}, {position.lng.toFixed(4)}</> : "Sin GPS"}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-bold tabular-nums">{format(now, "HH:mm:ss")}</div>
            <div className="text-xs text-muted-foreground">{format(now, "EEEE dd MMM yyyy")}</div>
          </div>
        </div>
      </header>

      <main className="container flex-1 py-6">
        {step === "list" && (
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9 h-12 text-base" placeholder="Buscar empleado por nombre o cédula…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {filtered.map((e) => (
                <button key={e.id} onClick={() => { setSelected(e); setStep("type"); }}
                  className="flex items-center gap-3 rounded-2xl border bg-card p-4 text-left transition hover:border-primary hover:shadow-lg hover:scale-[1.02]">
                  <div className="h-14 w-14 overflow-hidden rounded-full bg-muted ring-2 ring-primary/20">
                    {e.photo_url ? <img src={e.photo_url} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Sin foto</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{e.full_name}</div>
                    <div className="truncate text-xs text-muted-foreground">{e.job_position || "—"}</div>
                  </div>
                  {!e.face_descriptor && <Badge variant="outline" className="text-[10px]">Sin rostro</Badge>}
                </button>
              ))}
              {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground sm:col-span-2 md:col-span-3 py-8">Sin coincidencias.</p>}
            </div>
          </div>
        )}

        {step === "type" && selected && (
          <div className="mx-auto max-w-2xl space-y-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-24 w-24 overflow-hidden rounded-full bg-muted ring-4 ring-primary/30">
                {selected.photo_url && <img src={selected.photo_url} className="h-full w-full object-cover" />}
              </div>
              <div>
                <h2 className="text-2xl font-extrabold">{selected.full_name}</h2>
                <p className="text-sm text-muted-foreground">{selected.job_position || ""}</p>
              </div>
            </div>
            <p className="text-base font-semibold text-muted-foreground">¿Qué deseas registrar?</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {TYPE_OPTIONS.map(o => (
                <Button key={o.key} size="lg" className="h-20 text-base font-bold" onClick={() => { setRecordType(o.key); setStep("verify"); }}>
                  <o.icon className="mr-2 h-6 w-6" /> {o.label}
                </Button>
              ))}
            </div>
            <Button variant="ghost" onClick={reset}>Cancelar</Button>
          </div>
        )}

        {step === "verify" && selected && (
          <div className="mx-auto max-w-md space-y-6 text-center pt-2">
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold">
                {TYPE_OPTIONS.find(t => t.key === recordType)?.label}
              </p>
              <h2 className="text-xl font-bold">{selected.full_name}</h2>
            </div>

            <SmartFaceVerifier
              targetDescriptor={selected.face_descriptor}
              onMatch={handleFaceMatch}
              fallbackAfterMs={5000}
              onFallback={selected.document_id ? () => setStep("pin") : undefined}
              instruction={selected.face_descriptor
                ? "Centra tu rostro en el óvalo y mantente quieto un segundo"
                : "Solo se tomará una foto de evidencia"}
            />

            <Button variant="ghost" onClick={reset}>Cancelar</Button>
          </div>
        )}

        {step === "pin" && selected && (
          <div className="mx-auto max-w-sm space-y-5 text-center pt-2">
            <div className="flex flex-col items-center gap-2">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <KeyRound className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-extrabold">Ingresa tu cédula</h2>
              <p className="text-sm text-muted-foreground">{selected.full_name}</p>
            </div>
            <div className="rounded-2xl border bg-card p-4">
              <div className="font-mono text-3xl font-bold tabular-nums tracking-widest h-12 flex items-center justify-center">
                {pinValue ? "•".repeat(pinValue.length) : <span className="text-muted-foreground/40">····</span>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["1","2","3","4","5","6","7","8","9"].map(n => (
                <Button key={n} variant="outline" className="h-16 text-2xl font-bold" onClick={() => pressKey(n)}>{n}</Button>
              ))}
              <Button variant="outline" className="h-16 text-base font-semibold" onClick={() => pressKey("clear")}>C</Button>
              <Button variant="outline" className="h-16 text-2xl font-bold" onClick={() => pressKey("0")}>0</Button>
              <Button variant="outline" className="h-16" onClick={() => pressKey("back")}><Delete className="h-6 w-6" /></Button>
            </div>
            <Button size="lg" className="w-full h-14 text-base font-bold" onClick={handlePinSubmit} disabled={!pinValue.trim()}>
              Confirmar marcación
            </Button>
            <Button variant="ghost" onClick={() => setStep("verify")}>Volver a cámara</Button>
          </div>
        )}

        {step === "done" && doneInfo && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center animate-in fade-in zoom-in duration-300">
            <div className="relative">
              {doneInfo.photo ? (
                <img src={doneInfo.photo} className="h-32 w-32 rounded-full object-cover ring-8 ring-emerald-400 shadow-2xl shadow-emerald-500/40" />
              ) : (
                <CheckCircle2 className="h-24 w-24 text-emerald-500" />
              )}
              <div className="absolute -bottom-2 -right-2 rounded-full bg-emerald-500 p-2 shadow-lg">
                <CheckCircle2 className="h-6 w-6 text-white" />
              </div>
            </div>
            <h2 className="text-3xl font-display font-extrabold">¡{TYPE_OPTIONS.find(t => t.key === doneInfo.type)?.label} registrada!</h2>
            <p className="text-lg font-semibold">{doneInfo.name}</p>
            <p className="font-mono text-3xl font-bold">{doneInfo.time}</p>
            <Button onClick={reset} size="lg">Nueva marcación</Button>
          </div>
        )}
      </main>
    </div>
  );
}
