import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { StickyNote } from "lucide-react";
import { formatMoney } from "@/lib/format";

export interface SelectedModifier {
  id: string;
  group_id: string;
  group_name: string;
  name: string;
  price: number;
  qty: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  required: boolean;
}
interface Modifier {
  id: string;
  group_id: string;
  name: string;
  price: number;
  active: boolean;
}

interface Props {
  product: { id: string; name: string; price: number; modifier_group_ids: string[] } | null;
  onClose: () => void;
  onConfirm: (mods: SelectedModifier[], unitExtra: number, note?: string) => void;
}

export function ModifiersModal({ product, onClose, onConfirm }: Props) {
  const open = !!product;
  const groupIds = product?.modifier_group_ids ?? [];

  const { data: groups = [] } = useQuery<ModifierGroup[]>({
    queryKey: ["mod-groups", groupIds.sort().join(",")],
    enabled: open && groupIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("modifier_groups")
        .select("id,name,min_select,max_select,required")
        .in("id", groupIds);
      return (data ?? []) as ModifierGroup[];
    },
  });
  const { data: mods = [] } = useQuery<Modifier[]>({
    queryKey: ["mods-for", groupIds.sort().join(",")],
    enabled: open && groupIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("modifiers")
        .select("id,group_id,name,price,active")
        .in("group_id", groupIds)
        .eq("active", true)
        .order("name");
      return (data ?? []) as Modifier[];
    },
  });

  // Set of selected modifier ids (qty always 1 with checkbox/radio UI)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setNote("");
    }
  }, [open, product?.id]);

  const countsByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of mods) if (selected.has(m.id)) map[m.group_id] = (map[m.group_id] ?? 0) + 1;
    return map;
  }, [selected, mods]);

  const unitExtra = useMemo(
    () => mods.reduce((s, m) => s + (selected.has(m.id) ? Number(m.price) : 0), 0),
    [mods, selected],
  );

  const validation = useMemo(() => {
    for (const g of groups) {
      const c = countsByGroup[g.id] ?? 0;
      const min = g.required ? Math.max(1, g.min_select) : g.min_select;
      if (min > 0 && c < min) return `${g.name}: selecciona mínimo ${min}`;
      if (g.max_select > 0 && c > g.max_select) return `${g.name}: máximo ${g.max_select}`;
    }
    return null;
  }, [groups, countsByGroup]);

  function toggleCheckbox(m: Modifier, g: ModifierGroup, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        const currentGroup = countsByGroup[g.id] ?? 0;
        if (g.max_select > 0 && currentGroup >= g.max_select) return prev;
        next.add(m.id);
      } else {
        next.delete(m.id);
      }
      return next;
    });
  }

  function setRadio(g: ModifierGroup, modId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      // remove other selections of this group
      for (const m of mods) if (m.group_id === g.id) next.delete(m.id);
      next.add(modId);
      return next;
    });
  }

  function clearRadio(g: ModifierGroup) {
    if (g.required) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of mods) if (m.group_id === g.id) next.delete(m.id);
      return next;
    });
  }

  function confirm() {
    if (validation) return;
    const chosen: SelectedModifier[] = mods
      .filter((m) => selected.has(m.id))
      .map((m) => ({
        id: m.id,
        group_id: m.group_id,
        group_name: groups.find((g) => g.id === m.group_id)?.name ?? "",
        name: m.name,
        price: Number(m.price),
        qty: 1,
      }));
    onConfirm(chosen, unitExtra, note.trim() || undefined);
  }

  // Detect "single optional modifier" case:
  // exactly one active modifier across all groups, and that group is optional (not required, min_select == 0)
  const isSingleOptional =
    open && groups.length === 1 && mods.length === 1 && !groups[0].required && (groups[0].min_select ?? 0) === 0;

  if (!product) return null;

  // Compact single-checkbox layout — replaces the full customization window
  if (isSingleOptional) {
    const only = mods[0];
    const isChecked = selected.has(only.id);
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">{product.name}</DialogTitle>
            <DialogDescription className="sr-only">Agregar modificador opcional</DialogDescription>
          </DialogHeader>

          <label
            htmlFor={`single-mod-${only.id}`}
            className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-3 cursor-pointer hover:bg-muted/60 transition"
          >
            <Checkbox
              id={`single-mod-${only.id}`}
              checked={isChecked}
              onCheckedChange={(v) => toggleCheckbox(only, groups[0], !!v)}
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Agregar {only.name}</div>
              {Number(only.price) > 0 && (
                <div className="text-xs text-muted-foreground">+ {formatMoney(only.price)}</div>
              )}
            </div>
          </label>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={confirm}>
              Agregar · {formatMoney(Number(product.price) + unitExtra)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{product.name}</DialogTitle>
          <DialogDescription>Personaliza tu producto.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Sin opciones configuradas.</p>
          )}
          {groups.map((g) => {
            const groupMods = mods.filter((m) => m.group_id === g.id);
            const count = countsByGroup[g.id] ?? 0;
            const isSingle = g.max_select === 1;
            const currentRadioId = groupMods.find((m) => selected.has(m.id))?.id ?? "";
            const limitText = (() => {
              if (isSingle) return g.required ? "Elige 1 (obligatorio)" : "Elige 1 (opcional)";
              const parts: string[] = [];
              if (g.min_select > 0) parts.push(`mín ${g.min_select}`);
              if (g.max_select > 0) parts.push(`máx ${g.max_select}`);
              if (g.required && g.min_select === 0) parts.unshift("obligatorio");
              return parts.length ? parts.join(" · ") : "Opcional";
            })();

            return (
              <div key={g.id} className="space-y-2">
                <div className="flex items-center justify-between border-b pb-1">
                  <div>
                    <div className="font-medium">{g.name}</div>
                    <div className="text-xs text-muted-foreground">{limitText}</div>
                  </div>
                  <Badge variant={count > 0 ? "default" : "secondary"}>{count}</Badge>
                </div>

                {isSingle ? (
                  <RadioGroup
                    value={currentRadioId}
                    onValueChange={(v) => setRadio(g, v)}
                    className="space-y-1.5"
                  >
                    {groupMods.map((m) => {
                      const id = `mod-${m.id}`;
                      const isChecked = currentRadioId === m.id;
                      return (
                        <label
                          key={m.id}
                          htmlFor={id}
                          className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2 cursor-pointer hover:bg-muted/60 transition"
                        >
                          <RadioGroupItem
                            id={id}
                            value={m.id}
                            onClick={() => {
                              if (!g.required && isChecked) {
                                // Allow deselect on second click when optional
                                setTimeout(() => clearRadio(g), 0);
                              }
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{m.name}</div>
                            {Number(m.price) > 0 && (
                              <div className="text-xs text-muted-foreground">+ {formatMoney(m.price)}</div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                    {groupMods.length === 0 && (
                      <div className="text-xs text-muted-foreground py-1">Sin opciones</div>
                    )}
                  </RadioGroup>
                ) : (
                  <ul className="space-y-1.5">
                    {groupMods.map((m) => {
                      const id = `mod-${m.id}`;
                      const isChecked = selected.has(m.id);
                      const atMax = !isChecked && g.max_select > 0 && count >= g.max_select;
                      return (
                        <li key={m.id}>
                          <label
                            htmlFor={id}
                            className={`flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2 transition ${
                              atMax ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/60"
                            }`}
                          >
                            <Checkbox
                              id={id}
                              checked={isChecked}
                              disabled={atMax}
                              onCheckedChange={(v) => toggleCheckbox(m, g, !!v)}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{m.name}</div>
                              {Number(m.price) > 0 && (
                                <div className="text-xs text-muted-foreground">+ {formatMoney(m.price)}</div>
                              )}
                            </div>
                          </label>
                        </li>
                      );
                    })}
                    {groupMods.length === 0 && (
                      <li className="text-xs text-muted-foreground py-1">Sin opciones</li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="mod-note" className="flex items-center gap-1.5 text-sm font-medium">
            <StickyNote className="h-4 w-4" /> Nota adicional (opcional)
          </Label>
          <Textarea
            id="mod-note"
            placeholder="Ej: sin azúcar, extra cremoso, para llevar…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={200}
          />
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="mr-auto text-sm">
            {validation ? (
              <span className="text-destructive">{validation}</span>
            ) : (
              <span className="text-muted-foreground">
                Total adicional: <strong className="text-foreground">{formatMoney(unitExtra)}</strong>
              </span>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} disabled={!!validation}>
            Agregar · {formatMoney(Number(product.price) + unitExtra)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Build a multi-line product label that includes selected modifiers. Stored in sale_items.product_name. */
export function buildLineLabel(productName: string, mods: SelectedModifier[]): string {
  if (!mods.length) return productName;
  const lines = mods.map((m) => `  + ${m.qty}× ${m.name}`);
  return [productName, ...lines].join("\n");
}
