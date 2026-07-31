import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";

type KeyStatus = Record<string, { configured?: boolean; masked?: string; updated_at?: string }>;

/**
 * Clave del proveedor de IA guardada en el POS (base de datos), no en el
 * hosting. Así el asistente responde igual esté publicado donde esté.
 */
export function AiKeyCard() {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["ai-key-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_ai_key_status");
      if (error) throw error;
      return (data ?? {}) as KeyStatus;
    },
  });

  const gemini = status?.gemini;
  const configured = Boolean(gemini?.configured);

  const save = async (nextValue: string) => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("admin_set_ai_key", {
        _provider: "gemini",
        _api_key: nextValue,
      });
      if (error) throw error;
      setValue("");
      await qc.invalidateQueries({ queryKey: ["ai-key-status"] });
      toast.success(nextValue ? "Clave guardada. El asistente ya puede responder." : "Clave eliminada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la clave");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" /> Clave de Inteligencia Artificial
          {configured ? (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Configurada
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Falta configurar
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Sin esta clave, Golosito solo envía el mensaje de bienvenida y el menú: no puede
          recomendar productos ni tomar pedidos. Se guarda cifrada en el sistema y sirve para
          todas las sedes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {configured && (
          <p className="text-sm text-muted-foreground">
            Clave actual: <span className="font-mono">{gemini?.masked}</span>
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="ai-key">Clave de Google Gemini</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              placeholder="AIza..."
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button onClick={() => save(value.trim())} disabled={saving || value.trim().length < 20}>
              Guardar
            </Button>
            {configured && (
              <Button variant="outline" onClick={() => save("")} disabled={saving}>
                Quitar
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            La obtienes gratis en Google AI Studio. Al guardarla, el asistente empieza a responder
            de inmediato en todas las sedes conectadas.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
