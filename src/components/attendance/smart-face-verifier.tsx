import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, RotateCw, Loader2 } from "lucide-react";
import { loadFaceModels, getFaceDescriptor, euclideanDistance, FACE_MATCH_THRESHOLD } from "@/lib/face-api-loader";

interface Props {
  /** Target descriptor to match against. If null, success fires on any clear face. */
  targetDescriptor: number[] | null;
  /** Called with photo blob + match score (lower is better) once a match is detected. */
  onMatch: (blob: Blob, dataUrl: string, score: number | null) => void | Promise<void>;
  /** Show PIN fallback button after N ms without match. */
  fallbackAfterMs?: number;
  onFallback?: () => void;
  instruction?: string;
}

type Status = "loading" | "searching" | "centering" | "matching" | "locked" | "error";

export function SmartFaceVerifier({
  targetDescriptor,
  onMatch,
  fallbackAfterMs = 5000,
  onFallback,
  instruction = "Mira a la cámara",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef(false);
  const lockedRef = useRef(false);
  const stableHitsRef = useRef(0);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  async function start() {
    setError(null);
    setStatus("loading");
    try {
      await loadFaceModels();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStatus("searching");
      loop();
    } catch (e: any) {
      setError(e.message || "No se pudo acceder a la cámara");
      setStatus("error");
    }
  }

  async function loop() {
    if (stopRef.current || lockedRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      requestAnimationFrame(loop);
      return;
    }
    try {
      const detection = await getFaceDescriptor(video, { inputSize: 224, scoreThreshold: 0.4 });
      if (lockedRef.current) return;
      if (!detection) {
        stableHitsRef.current = 0;
        setStatus("searching");
      } else {
        const box = detection.detection.box;
        const vw = video.videoWidth, vh = video.videoHeight;
        // Heuristic: face must occupy at least 18% of the frame height and be roughly centered
        const sizeOk = box.height / vh > 0.28;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const centered = Math.abs(cx - vw / 2) < vw * 0.22 && Math.abs(cy - vh / 2) < vh * 0.22;

        if (!sizeOk || !centered) {
          stableHitsRef.current = 0;
          setStatus("centering");
        } else {
          let dist: number | null = null;
          if (targetDescriptor && targetDescriptor.length) {
            dist = euclideanDistance(detection.descriptor, targetDescriptor);
            setScore(Number(dist.toFixed(3)));
          }
          const matched = !targetDescriptor || (dist !== null && dist <= FACE_MATCH_THRESHOLD);
          if (matched) {
            stableHitsRef.current += 1;
            setStatus("matching");
            if (stableHitsRef.current >= 2) {
              await fireMatch(dist);
              return;
            }
          } else {
            stableHitsRef.current = 0;
            setStatus("centering");
          }
        }
      }
    } catch {
      /* swallow per-frame errors */
    }
    if (!stopRef.current && !lockedRef.current) {
      setTimeout(loop, 120); // ~8 fps detection; smooth and battery-friendly
    }
  }

  async function fireMatch(dist: number | null) {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setStatus("locked");
    const video = videoRef.current!;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.85));
    playBeep();
    try {
      await onMatch(blob, dataUrl, dist);
    } catch {
      lockedRef.current = false;
      setStatus("searching");
      setTimeout(loop, 200);
    }
  }

  function playBeep() {
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ac = new Ctx();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = 880;
      o.type = "sine";
      g.gain.setValueAtTime(0.001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.25);
      o.start(); o.stop(ac.currentTime + 0.26);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    stopRef.current = false;
    lockedRef.current = false;
    start();
    const t = onFallback ? setTimeout(() => setShowFallback(true), fallbackAfterMs) : null;
    return () => {
      stopRef.current = true;
      lockedRef.current = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (t) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringColor =
    status === "locked" || status === "matching"
      ? "ring-emerald-400 shadow-[0_0_60px_theme(colors.emerald.400)]"
      : status === "centering"
        ? "ring-amber-400 shadow-[0_0_40px_theme(colors.amber.400/.7)]"
        : status === "error"
          ? "ring-rose-500"
          : "ring-slate-400/60";

  const message =
    status === "loading"
      ? "Preparando cámara…"
      : status === "searching"
        ? "Buscando rostro…"
        : status === "centering"
          ? "Centra tu rostro en el óvalo"
          : status === "matching"
            ? "Validando…"
            : status === "locked"
              ? "¡Identidad confirmada!"
              : "Error de cámara";

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative">
        {/* Camera container */}
        <div
          className={`relative h-72 w-72 sm:h-96 sm:w-96 overflow-hidden rounded-full bg-slate-900 ring-8 transition-all duration-300 ${ringColor}`}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-full w-full object-cover scale-x-[-1]"
          />
          {/* Oval guide overlay */}
          <svg viewBox="0 0 200 200" className="pointer-events-none absolute inset-0 h-full w-full">
            <ellipse
              cx="100"
              cy="100"
              rx="68"
              ry="86"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeDasharray="6 6"
              className={
                status === "locked" || status === "matching"
                  ? "text-emerald-300"
                  : status === "centering"
                    ? "text-amber-300"
                    : "text-white/70"
              }
            />
          </svg>
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 text-white">
              <Loader2 className="h-10 w-10 animate-spin" />
            </div>
          )}
          {status === "locked" && (
            <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/30 animate-pulse" />
          )}
        </div>
        {score !== null && status !== "loading" && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-xs font-mono shadow">
            score {score}
          </div>
        )}
      </div>

      <p className="font-extrabold text-2xl sm:text-3xl tracking-tight text-center">
        {message}
      </p>
      {status !== "locked" && (
        <p className="text-sm text-muted-foreground -mt-3">{instruction}</p>
      )}

      {error && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-destructive text-sm">{error}</p>
          <Button size="sm" variant="outline" onClick={start}>
            <RotateCw className="mr-2 h-4 w-4" /> Reintentar
          </Button>
        </div>
      )}

      {showFallback && onFallback && status !== "locked" && (
        <Button
          variant="outline"
          size="lg"
          className="mt-2 animate-in fade-in slide-in-from-bottom-3"
          onClick={onFallback}
        >
          <Camera className="mr-2 h-4 w-4" /> Ingresar con PIN / Cédula
        </Button>
      )}
    </div>
  );
}
