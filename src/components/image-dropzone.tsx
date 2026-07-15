import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  bucket?: string;
  pathPrefix?: string;
  maxDim?: number;
  quality?: number;
  className?: string;
}

let webpSupport: boolean | null = null;
function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpSupport = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

async function compressImage(file: File, maxDim: number, quality: number): Promise<Blob> {
  // Skip only for very small files
  if (file.size < 40 * 1024 && file.type === "image/webp") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const useWebp = supportsWebp();
  const mime = useWebp ? "image/webp" : "image/jpeg";
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, mime, quality));
  return blob && blob.size < file.size ? blob : file;
}

export function ImageDropzone({ value, onChange, bucket = "products", pathPrefix = "prod", maxDim = 800, quality = 0.82, className = "" }: Props) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("El archivo no es una imagen"); return; }
    setBusy(true);
    try {
      const blob = await compressImage(file, maxDim, quality);
      const ext = blob.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop()?.toLowerCase() || "jpg");
      const path = `${pathPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType: blob.type || `image/${ext}` });
      if (up.error) throw up.error;
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
      if (signed?.signedUrl) {
        onChange(signed.signedUrl);
        toast.success("Foto lista");
      }
    } catch (e: any) {
      toast.error(e?.message || "Error al subir imagen");
    } finally {
      setBusy(false);
    }
  }, [bucket, pathPrefix, maxDim, quality, onChange]);

  // Paste from clipboard
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); upload(file); }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [upload]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  };

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 bg-muted/30"} ${className}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }}
      />
      {value ? (
        <div className="flex items-center gap-3 p-3">
          <img src={value} alt="" className="h-24 w-24 rounded-lg border object-cover" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium">Imagen cargada</p>
            <p className="text-xs text-muted-foreground">Arrastra otra, pega (Ctrl+V) o toca cambiar.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} Cambiar
              </Button>
              <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => onChange(null)} disabled={busy}>
                <Trash2 className="h-4 w-4 mr-1" /> Quitar
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex w-full flex-col items-center justify-center gap-2 py-8 px-4 text-center"
        >
          {busy ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <ImagePlus className="h-8 w-8 text-muted-foreground" />}
          <p className="text-sm font-medium">{busy ? "Subiendo..." : "Toca, arrastra o pega una imagen"}</p>
          <p className="text-xs text-muted-foreground">PNG · JPG · WEBP · BMP · Se optimiza automáticamente</p>
        </button>
      )}
    </div>
  );
}
