import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Check, Save, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  CommandFormat,
  CommandFormatsMap,
  DEFAULT_FORMATS,
  normalizeFormat,
  renderPreview,
} from "@/lib/command-format";

type SettingsRow = {
  id: number;
  command_formats: CommandFormatsMap | null;
  command_format_active: string | null;
};

const PRESET_ORDER = ["clasico", "compacto", "grande"] as const;

export function ComandasFormatTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<SettingsRow | null>({
    queryKey: ["settings-command-formats"],
    queryFn: async () => {
      const { data } = await supabase
        .from("settings")
        .select("id, command_formats, command_format_active")
        .limit(1)
        .maybeSingle();
      return (data as unknown as SettingsRow) ?? null;
    },
  });

  const [formats, setFormats] = useState<CommandFormatsMap>(DEFAULT_FORMATS);
  const [active, setActive] = useState<string>("clasico");
  const [selected, setSelected] = useState<string>("clasico");

  useEffect(() => {
    if (!data) return;
    const src = data.command_formats ?? {};
    const merged: CommandFormatsMap = {};
    for (const k of PRESET_ORDER) merged[k] = normalizeFormat(src[k] ?? DEFAULT_FORMATS[k]);
    setFormats(merged);
    setActive(data.command_format_active ?? "clasico");
  }, [data]);

  const current = formats[selected] ?? DEFAULT_FORMATS.clasico;
  const preview = useMemo(() => renderPreview(current), [current]);

  const updateCurrent = (patch: Partial<CommandFormat>) => {
    setFormats((prev) => ({ ...prev, [selected]: { ...prev[selected], ...patch } as CommandFormat }));
  };
  const updateNested = <K extends "bold" | "align" | "separator" | "margins">(
    key: K,
    patch: Partial<CommandFormat[K]>,
  ) => {
    setFormats((prev) => ({
      ...prev,
      [selected]: { ...prev[selected], [key]: { ...prev[selected][key], ...patch } } as CommandFormat,
    }));
  };

  const saveMut = useMutation({
    mutationFn: async (payload: { formats: CommandFormatsMap; active: string }) => {
      const { data: row } = await supabase.from("settings").select("id").limit(1).maybeSingle();
      const values = {
        command_formats: payload.formats as unknown as never,
        command_format_active: payload.active as unknown as never,
      };
      if (row?.id) {
        const { error } = await supabase.from("settings").update(values).eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("settings").insert(values);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Formato de comanda guardado. Se aplicará a las próximas impresiones.");
      qc.invalidateQueries({ queryKey: ["settings-command-formats"] });
      // Refrescar el cache del cliente de impresión.
      import("@/lib/print-client").then((m) => m.refreshCommandFormatCache?.());
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const setAsActive = () => {
    setActive(selected);
    toast.info(`"${current.label}" quedará como formato activo al guardar`);
  };

  const resetPreset = () => {
    setFormats((prev) => ({ ...prev, [selected]: DEFAULT_FORMATS[selected] ?? DEFAULT_FORMATS.clasico }));
    toast.info("Formato restablecido a valores por defecto");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Formato de comandas de cocina</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Personaliza cómo se imprimen las comandas. Los cambios se aplican automáticamente al Print Server sin reiniciar ni reinstalar.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetPreset} disabled={isLoading}>
              <RotateCcw className="h-4 w-4 mr-1" /> Restablecer
            </Button>
            <Button
              onClick={() => saveMut.mutate({ formats, active })}
              disabled={saveMut.isPending || isLoading}
            >
              <Save className="h-4 w-4 mr-1" /> Guardar cambios
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Selector de preset */}
        <div className="flex flex-wrap gap-2">
          {PRESET_ORDER.map((key) => {
            const isSelected = key === selected;
            const isActive = key === active;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                className={`px-4 py-2 rounded-lg border text-sm transition-all ${
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card hover:bg-muted border-border"
                }`}
              >
                <span className="font-medium">{formats[key]?.label ?? key}</span>
                {isActive && (
                  <Badge variant="secondary" className="ml-2 gap-1">
                    <Check className="h-3 w-3" /> Activo
                  </Badge>
                )}
              </button>
            );
          })}
          {selected !== active && (
            <Button variant="secondary" size="sm" onClick={setAsActive}>
              Usar este formato al imprimir
            </Button>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Editor */}
          <div className="space-y-4">
            <div>
              <Label>Nombre del formato</Label>
              <Input
                value={current.label}
                onChange={(e) => updateCurrent({ label: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Tipo de letra" value={current.font} onChange={(v) => updateCurrent({ font: v as "A" | "B" })}
                options={[["A", "Fuente A (estándar)"], ["B", "Fuente B (condensada)"]]} />
              <SelectField label="Tamaño título" value={String(current.titleSize)} onChange={(v) => updateCurrent({ titleSize: Number(v) as CommandFormat["titleSize"] })}
                options={[["1", "1× normal"], ["2", "2× doble"], ["3", "3× triple"], ["4", "4× máximo"]]} />
              <SelectField label="Tamaño producto" value={String(current.productSize)} onChange={(v) => updateCurrent({ productSize: Number(v) as CommandFormat["productSize"] })}
                options={[["1", "1×"], ["2", "2×"], ["3", "3×"], ["4", "4×"]]} />
              <SelectField label="Tamaño modificadores" value={String(current.modifierSize)} onChange={(v) => updateCurrent({ modifierSize: Number(v) as CommandFormat["modifierSize"] })}
                options={[["1", "1×"], ["2", "2×"], ["3", "3×"]]} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <SwitchField label="Título en negrita" checked={current.bold.title} onChange={(v) => updateNested("bold", { title: v })} />
              <SwitchField label="Producto en negrita" checked={current.bold.product} onChange={(v) => updateNested("bold", { product: v })} />
              <SwitchField label="Modificadores en negrita" checked={current.bold.modifier} onChange={(v) => updateNested("bold", { modifier: v })} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <SelectField label="Alineación encabezado" value={current.align.header} onChange={(v) => updateNested("align", { header: v as CommandFormat["align"]["header"] })}
                options={[["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"]]} />
              <SelectField label="Alineación productos" value={current.align.product} onChange={(v) => updateNested("align", { product: v as CommandFormat["align"]["product"] })}
                options={[["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"]]} />
              <SelectField label="Alineación tipo pedido" value={current.align.orderType} onChange={(v) => updateNested("align", { orderType: v as CommandFormat["align"]["orderType"] })}
                options={[["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"]]} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Separador" value={current.separator.char} onChange={(v) => updateNested("separator", { char: v as CommandFormat["separator"]["char"] })}
                options={[["-", "----"], ["=", "===="], ["*", "****"], [".", "...."], [" ", "sin línea"]]} />
              <SelectField label="Líneas en blanco tras separador" value={String(current.separator.blankLines)} onChange={(v) => updateNested("separator", { blankLines: Number(v) as CommandFormat["separator"]["blankLines"] })}
                options={[["0", "Ninguna"], ["1", "1 línea"], ["2", "2 líneas"]]} />
              <SelectField label="Espaciado entre líneas" value={String(current.lineSpacing)} onChange={(v) => updateCurrent({ lineSpacing: Number(v) as CommandFormat["lineSpacing"] })}
                options={[["0", "Normal"], ["1", "+1 salto"], ["2", "+2 saltos"], ["3", "+3 saltos"]]} />
              <SelectField label="Márgenes (izq/der)" value={`${current.margins.left}-${current.margins.right}`} onChange={(v) => {
                const [l, r] = v.split("-").map(Number);
                updateNested("margins", { left: l as CommandFormat["margins"]["left"], right: r as CommandFormat["margins"]["right"] });
              }}
                options={[["0-0", "0 / 0"], ["1-1", "1 / 1"], ["2-2", "2 / 2"], ["3-3", "3 / 3"], ["4-4", "4 / 4"]]} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Estilo de modificadores" value={current.modifiersLayout} onChange={(v) => updateCurrent({ modifiersLayout: v as CommandFormat["modifiersLayout"] })}
                options={[["inline", "En línea: + A + B + C"], ["list", "Lista: cada uno en su línea"]]} />
              <SelectField label="Formato cantidad" value={current.quantityFormat} onChange={(v) => updateCurrent({ quantityFormat: v as CommandFormat["quantityFormat"] })}
                options={[["x", "2x"], ["times", "2×"], ["paren", "(2)"]]} />
              <SelectField label="Formato n.º pedido" value={current.orderNumberFormat} onChange={(v) => updateCurrent({ orderNumberFormat: v as CommandFormat["orderNumberFormat"] })}
                options={[["hash", "#123"], ["pedido", "PEDIDO 123"], ["ticket", "TICKET #123"]]} />
              <SelectField label="Formato mesa" value={current.tableFormat} onChange={(v) => updateCurrent({ tableFormat: v as CommandFormat["tableFormat"] })}
                options={[["MESA N", "MESA 4"], ["Mesa: N", "Mesa: 4"], ["MN", "M4"]]} />
              <SelectField label="Formato tipo de pedido" value={current.orderTypeFormat} onChange={(v) => updateCurrent({ orderTypeFormat: v as CommandFormat["orderTypeFormat"] })}
                options={[["prefix", "PEDIDO PARA MESA"], ["arrow", ">> PARA MESA"], ["hidden", "Oculto"]]} />
            </div>
          </div>

          {/* Vista previa */}
          <div>
            <Label className="mb-2 block">Vista previa (aprox. 42 columnas)</Label>
            <div className="rounded-md border bg-white text-black p-4 shadow-inner">
              <pre
                className="whitespace-pre font-mono text-[12px] leading-tight text-black"
                style={{ fontFamily: '"Courier New", ui-monospace, monospace' }}
              >
                {preview}
              </pre>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              La impresión real usará las fuentes y tamaños ESC/POS de la impresora térmica. La vista previa muestra la estructura, alineación y separadores. Los <b>**textos**</b> aparecerán en negrita en la impresora.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
