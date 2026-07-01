import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Gift, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface LoyaltyCfg {
  loyalty_enabled: boolean;
  loyalty_points_per_1000: number;
  loyalty_point_value: number;
  loyalty_min_redeem: number;
  loyalty_expiration_days: number;
  loyalty_welcome_text: string | null;
}

export function FidelizacionTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings-loyalty"],
    queryFn: async () => {
      const { data } = await supabase
        .from("settings")
        .select("id,loyalty_enabled,loyalty_points_per_1000,loyalty_point_value,loyalty_min_redeem,loyalty_expiration_days,loyalty_welcome_text")
        .maybeSingle();
      return data as (LoyaltyCfg & { id: number }) | null;
    },
  });

  const [cfg, setCfg] = useState<LoyaltyCfg>({
    loyalty_enabled: true,
    loyalty_points_per_1000: 1,
    loyalty_point_value: 10,
    loyalty_min_redeem: 100,
    loyalty_expiration_days: 0,
    loyalty_welcome_text: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setCfg({
        loyalty_enabled: data.loyalty_enabled ?? true,
        loyalty_points_per_1000: data.loyalty_points_per_1000 ?? 1,
        loyalty_point_value: Number(data.loyalty_point_value ?? 10),
        loyalty_min_redeem: data.loyalty_min_redeem ?? 100,
        loyalty_expiration_days: data.loyalty_expiration_days ?? 0,
        loyalty_welcome_text: data.loyalty_welcome_text ?? "",
      });
    }
  }, [data]);

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/mis-puntos` : "/mis-puntos";

  async function save() {
    if (!data?.id) return toast.error("Falta el registro de ajustes");
    setSaving(true);
    const { error } = await supabase.from("settings").update(cfg as never).eq("id", data.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Configuración guardada");
    qc.invalidateQueries({ queryKey: ["settings-loyalty"] });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gift className="h-5 w-5" /> Programa de Fidelización</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sin registro: los clientes acumulan puntos automáticamente por su teléfono. Pueden consultar su saldo desde el link público.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="font-medium">Activar programa</div>
              <div className="text-xs text-muted-foreground">Si lo desactivas, no se acumulan ni canjean puntos.</div>
            </div>
            <Switch
              checked={cfg.loyalty_enabled}
              onCheckedChange={(v) => setCfg((c) => ({ ...c, loyalty_enabled: v }))}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Puntos que otorga cada $1.000 gastados</Label>
              <Input
                type="number" min={0} step={1}
                value={cfg.loyalty_points_per_1000}
                onChange={(e) => setCfg((c) => ({ ...c, loyalty_points_per_1000: Math.max(0, Number(e.target.value) || 0) }))}
              />
              <p className="text-[11px] text-muted-foreground">Ej: 1 = un cliente que gasta $10.000 gana 10 puntos.</p>
            </div>
            <div className="space-y-1">
              <Label>Valor de cada punto (COP)</Label>
              <Input
                type="number" min={0} step={1}
                value={cfg.loyalty_point_value}
                onChange={(e) => setCfg((c) => ({ ...c, loyalty_point_value: Math.max(0, Number(e.target.value) || 0) }))}
              />
              <p className="text-[11px] text-muted-foreground">Al canjear, 1 punto vale este monto.</p>
            </div>
            <div className="space-y-1">
              <Label>Mínimo de puntos para canjear</Label>
              <Input
                type="number" min={0} step={10}
                value={cfg.loyalty_min_redeem}
                onChange={(e) => setCfg((c) => ({ ...c, loyalty_min_redeem: Math.max(0, Number(e.target.value) || 0) }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Vencimiento (días, 0 = nunca)</Label>
              <Input
                type="number" min={0} step={1}
                value={cfg.loyalty_expiration_days}
                onChange={(e) => setCfg((c) => ({ ...c, loyalty_expiration_days: Math.max(0, Number(e.target.value) || 0) }))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Mensaje de bienvenida (opcional)</Label>
            <Textarea
              value={cfg.loyalty_welcome_text ?? ""}
              onChange={(e) => setCfg((c) => ({ ...c, loyalty_welcome_text: e.target.value }))}
              placeholder="Ej: ¡Bienvenido a Goloso Club! Acumula puntos con cada compra y canjéalos por productos."
              rows={3}
              maxLength={280}
            />
          </div>

          <div className="rounded-md border bg-muted/40 p-3 space-y-2">
            <div className="text-sm font-medium">Link público para consultar puntos</div>
            <div className="flex items-center gap-2">
              <Input readOnly value={publicUrl} className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Link copiado"); }}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="outline" onClick={() => window.open(publicUrl, "_blank")}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Compártelo con tus clientes. Ingresan su teléfono y ven puntos, historial y monto disponible para canjear. Sin login.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
