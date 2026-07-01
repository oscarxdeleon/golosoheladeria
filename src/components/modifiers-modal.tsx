import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Minus, Plus, StickyNote } from "lucide-react";
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
  onConfirm: (mods: SelectedModifier[], unitExtra: number) => void;
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

  // qty per modifier id
  const [picked, setPicked] = useState<Record<string, number>>({});
  useEffect(() => {
    if (open) setPicked({});
  }, [open, product?.id]);

  const countsByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of mods) {
      const q = picked[m.id] ?? 0;
      if (q > 0) map[m.group_id] = (map[m.group_id] ?? 0) + q;
    }
    return map;
  }, [picked, mods]);

  const unitExtra = useMemo(
    () => mods.reduce((s, m) => s + (picked[m.id] ?? 0) * Number(m.price), 0),
    [mods, picked],
  );

  const validation = useMemo(() => {
    for (const g of groups) {
      const c = countsByGroup[g.id] ?? 0;
      if (g.required && c < Math.max(1, g.min_select)) {
        return `${g.name}: selecciona mínimo ${Math.max(1, g.min_select)}`;
      }
      if (g.min_select > 0 && c < g.min_select) {
        return `${g.name}: selecciona mínimo ${g.min_select}`;
      }
      if (g.max_select > 0 && c > g.max_select) {
        return `${g.name}: máximo ${g.max_select}`;
      }
    }
    return null;
  }, [groups, countsByGroup]);

  function inc(m: Modifier) {
    const g = groups.find((gr) => gr.id === m.group_id);
    const currentGroup = countsByGroup[m.group_id] ?? 0;
    if (g && g.max_select > 0 && currentGroup >= g.max_select) return;
    setPicked((p) => ({ ...p, [m.id]: (p[m.id] ?? 0) + 1 }));
  }
  function dec(m: Modifier) {
    setPicked((p) => {
      const v = (p[m.id] ?? 0) - 1;
      const next = { ...p };
      if (v <= 0) delete next[m.id];
      else next[m.id] = v;
      return next;
    });
  }

  function confirm() {
    if (validation) return;
    const selected: SelectedModifier[] = mods
      .filter((m) => (picked[m.id] ?? 0) > 0)
      .map((m) => ({
        id: m.id,
        group_id: m.group_id,
        group_name: groups.find((g) => g.id === m.group_id)?.name ?? "",
        name: m.name,
        price: Number(m.price),
        qty: picked[m.id]!,
      }));
    onConfirm(selected, unitExtra);
  }

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{product.name}</DialogTitle>
          <DialogDescription>
            Personaliza tu producto. Usa los botones <strong>+</strong> y <strong>−</strong> para elegir cantidades.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Sin opciones configuradas.</p>
          )}
          {groups.map((g) => {
            const groupMods = mods.filter((m) => m.group_id === g.id);
            const count = countsByGroup[g.id] ?? 0;
            return (
              <div key={g.id} className="space-y-2">
                <div className="flex items-center justify-between border-b pb-1">
                  <div>
                    <div className="font-medium">{g.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {g.required ? "Obligatorio · " : ""}
                      Mín {g.min_select} · Máx {g.max_select}
                    </div>
                  </div>
                  <Badge variant={count > 0 ? "default" : "secondary"}>{count}</Badge>
                </div>
                <ul className="space-y-1.5">
                  {groupMods.map((m) => {
                    const q = picked[m.id] ?? 0;
                    const atMax = g.max_select > 0 && count >= g.max_select;
                    return (
                      <li key={m.id} className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{m.name}</div>
                          {Number(m.price) > 0 && (
                            <div className="text-xs text-muted-foreground">+ {formatMoney(m.price)}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            disabled={q === 0}
                            onClick={() => dec(m)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-7 text-center text-sm font-semibold">{q}</span>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            disabled={atMax}
                            onClick={() => inc(m)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                  {groupMods.length === 0 && (
                    <li className="text-xs text-muted-foreground py-1">Sin opciones</li>
                  )}
                </ul>
              </div>
            );
          })}
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
