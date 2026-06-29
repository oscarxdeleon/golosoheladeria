import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, RotateCw } from "lucide-react";

interface Props {
  onCapture: (blob: Blob, dataUrl: string, videoEl: HTMLVideoElement) => void;
  autoStart?: boolean;
  buttonLabel?: string;
}

export function CameraCapture({ onCapture, autoStart = true, buttonLabel = "Capturar" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
      }
    } catch (e: any) {
      setError(e.message || "No se pudo acceder a la cámara");
    }
  }

  useEffect(() => {
    if (autoStart) start();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.85));
    onCapture(blob, dataUrl, video);
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Solicitando permiso de cámara…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm">
            <p className="text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={start}>
              <RotateCw className="mr-2 h-4 w-4" /> Reintentar
            </Button>
          </div>
        )}
      </div>
      <Button onClick={capture} disabled={!ready} className="w-full" size="lg">
        <Camera className="mr-2 h-5 w-5" /> {buttonLabel}
      </Button>
    </div>
  );
}
