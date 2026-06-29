import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScanFace, LogIn, LogOut, Coffee, Play, Search, MapPin, CheckCircle2 } from "lucide-react";
import { CameraCapture } from "@/components/attendance/camera-capture";
import { loadFaceModels, getFaceDescriptor, euclideanDistance, FACE_MATCH_THRESHOLD } from "@/lib/face-api-loader";
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
  const [step, setStep] = useState<"list" | "type" | "verify" | "done">("list");
  const [recordType, setRecordType] = useState<string>("");
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [doneInfo, setDoneInfo] = useState<{ name: string; type: string; time: string } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.rpc("terminal_list_employees", { _slug: slug });
        if (error) throw error;
        setEmployees((data ?? []) as Employee[]);
        loadFaceModels().catch(() => {});
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
    return employees.filter(e => e.full_name.toLowerCase().includes(s) || (e.job_position ?? "").toLowerCase().includes(s));
  }, [employees, search]);

  function reset() {
    setSelected(null); setStep("list"); setRecordType(""); setDoneInfo(null); setSearch("");
  }

  async function handleVerification(blob: Blob, _dataUrl: string, video: HTMLVideoElement) {
    if (!selected) return;
    try {
      await loadFaceModels();
      const desc = await getFaceDescriptor(video);
      let score: number | null = null;
      if (selected.face_descriptor && desc) {
        const dist = euclideanDistance(desc, selected.face_descriptor as any);
        score = Number(dist.toFixed(3));
        if (dist > FACE_MATCH_THRESHOLD) {
          toast.error("El rostro no coincide con el empleado seleccionado.");
          return;
        }
      } else if (!desc) {
        toast.error("No se detectó un rostro claro. Intenta de nuevo.");
        return;
      }

      // Upload photo
      const path = `records/${Date.now()}-${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("attendance").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("attendance").createSignedUrl(path, 60 * 60 * 24 * 365);

      const { data, error } = await supabase.rpc("terminal_record_attendance", {
        _payload: {
          terminal_slug: slug,
          employee_id: selected.id,
          record_type: recordType,
          lat: position?.lat?.toString() ?? "",
          lng: position?.lng?.toString() ?? "",
          address: "",
          photo_url: signed?.signedUrl ?? "",
          face_match_score: score?.toString() ?? "",
          device_info: { ua: navigator.userAgent },
        },
      });
      if (error) throw error;
      const info = data as any;
      setDoneInfo({ name: info.employee_name, type: info.record_type, time: format(new Date(info.recorded_at), "HH:mm:ss") });
      setStep("done");
      setTimeout(reset, 5000);
    } catch (e: any) {
      toast.error(e.message || "Error al registrar marcación");
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Cargando terminal…</div>;
  if (error) return <div className="flex min-h-screen items-center justify-center text-rose-500">{error}</div>;
  const terminalName = employees[0]?.terminal_name ?? "Terminal de Asistencia";

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-primary/5 to-background">
      <header className="border-b bg-background/60 backdrop-blur">
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
              <Input className="pl-9 h-12 text-base" placeholder="Buscar empleado…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {filtered.map((e) => (
                <button key={e.id} onClick={() => { setSelected(e); setStep("type"); }}
                  className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary hover:shadow-md">
                  <div className="h-14 w-14 overflow-hidden rounded-full bg-muted">
                    {e.photo_url ? <img src={e.photo_url} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Sin foto</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{e.full_name}</div>
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
              <div className="h-24 w-24 overflow-hidden rounded-full bg-muted">
                {selected.photo_url && <img src={selected.photo_url} className="h-full w-full object-cover" />}
              </div>
              <div>
                <h2 className="text-2xl font-semibold">{selected.full_name}</h2>
                <p className="text-sm text-muted-foreground">{selected.job_position || ""}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">¿Qué deseas registrar?</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {TYPE_OPTIONS.map(o => (
                <Button key={o.key} size="lg" className="h-20 text-base" onClick={() => { setRecordType(o.key); setStep("verify"); }}>
                  <o.icon className="mr-2 h-6 w-6" /> {o.label}
                </Button>
              ))}
            </div>
            <Button variant="ghost" onClick={reset}>Cancelar</Button>
          </div>
        )}

        {step === "verify" && selected && (
          <div className="mx-auto max-w-md space-y-4 text-center">
            <h2 className="text-xl font-semibold">{TYPE_OPTIONS.find(t => t.key === recordType)?.label} · {selected.full_name}</h2>
            <p className="text-sm text-muted-foreground">Mira a la cámara y presiona <strong>Capturar</strong> para validar tu rostro.</p>
            <CameraCapture onCapture={handleVerification} buttonLabel="Capturar y registrar" />
            <Button variant="ghost" onClick={reset}>Cancelar</Button>
          </div>
        )}

        {step === "done" && doneInfo && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
            <CheckCircle2 className="h-20 w-20 text-emerald-500" />
            <h2 className="text-3xl font-display font-semibold">¡{TYPE_OPTIONS.find(t => t.key === doneInfo.type)?.label} registrada!</h2>
            <p className="text-lg">{doneInfo.name}</p>
            <p className="font-mono text-2xl">{doneInfo.time}</p>
            <Button onClick={reset}>Nueva marcación</Button>
          </div>
        )}
      </main>
    </div>
  );
}
