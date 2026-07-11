import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Tipos mínimos para Web Speech API (no vienen en lib.dom por defecto en algunos TS setups)
interface SRResultAlternative { transcript: string }
interface SRResult { 0: SRResultAlternative; isFinal: boolean; length: number }
interface SREvent { results: ArrayLike<SRResult>; resultIndex: number }
interface SRErrorEvent { error: string }
interface SRInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SRCtor = new () => SRInstance;

function getSRCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isVoiceInputSupported(): boolean {
  return getSRCtor() !== null;
}

interface VoiceMicButtonProps {
  onTranscript: (text: string, isFinal: boolean) => void;
  lang?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "icon";
  title?: string;
}

/**
 * Botón de micrófono independiente para dictado por voz.
 * Usa Web Speech API nativa del navegador (sin costo, sin API externa).
 * En dispositivos no compatibles no se renderiza.
 */
export function VoiceMicButton({
  onTranscript,
  lang = "es-CO",
  className,
  disabled,
  size = "icon",
  title = "Dictar por voz",
}: VoiceMicButtonProps) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SRInstance | null>(null);
  const supported = isVoiceInputSupported();

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* noop */ } }, []);

  const start = useCallback(() => {
    const Ctor = getSRCtor();
    if (!Ctor) {
      toast.info("Tu navegador no soporta reconocimiento de voz. Prueba con Chrome, Edge o el navegador de Android.");
      return;
    }
    try {
      const r = new Ctor();
      r.lang = lang;
      r.interimResults = true;
      r.continuous = false;
      r.onresult = (e) => {
        let interim = "";
        let finalText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const t = res[0]?.transcript ?? "";
          if (res.isFinal) finalText += t;
          else interim += t;
        }
        if (finalText) onTranscript(finalText.trim(), true);
        else if (interim) onTranscript(interim.trim(), false);
      };
      r.onerror = (e) => {
        setListening(false);
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          toast.error("Permiso de micrófono denegado");
        } else if (e.error === "no-speech") {
          toast.info("No se detectó voz");
        } else if (e.error !== "aborted") {
          toast.error(`Error de dictado: ${e.error}`);
        }
      };
      r.onend = () => setListening(false);
      recRef.current = r;
      r.start();
      setListening(true);
    } catch (err) {
      console.warn("[voice] no se pudo iniciar", err);
      setListening(false);
    }
  }, [lang, onTranscript]);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  }, []);

  if (!supported) return null;

  return (
    <Button
      type="button"
      variant={listening ? "destructive" : "outline"}
      size={size}
      disabled={disabled}
      onClick={() => (listening ? stop() : start())}
      title={listening ? "Detener dictado" : title}
      aria-label={listening ? "Detener dictado" : title}
      className={cn("shrink-0", listening && "animate-pulse", className)}
    >
      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </Button>
  );
}

interface VoiceInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onValueChange: (v: string) => void;
  lang?: string;
  multiline?: boolean;
  rows?: number;
  appendMode?: boolean; // si true, agrega al texto existente; si false, reemplaza
}

/**
 * Input (o Textarea) con botón de micrófono al lado para dictar por voz.
 */
export function VoiceInput({
  value,
  onValueChange,
  lang,
  multiline,
  rows,
  appendMode = true,
  className,
  ...rest
}: VoiceInputProps) {
  const baseRef = useRef<string>(value);
  useEffect(() => { baseRef.current = value; }, [value]);

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    if (!text) return;
    if (appendMode) {
      const base = baseRef.current ?? "";
      const sep = base && !base.endsWith(" ") ? " " : "";
      onValueChange(base + sep + text);
      if (isFinal) baseRef.current = base + sep + text;
    } else {
      onValueChange(text);
    }
  }, [appendMode, onValueChange]);

  return (
    <div className="flex gap-2 items-start">
      {multiline ? (
        <Textarea
          {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          rows={rows}
          className={cn("flex-1", className)}
        />
      ) : (
        <Input
          {...rest}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className={cn("flex-1", className)}
        />
      )}
      <VoiceMicButton onTranscript={handleTranscript} lang={lang} />
    </div>
  );
}
