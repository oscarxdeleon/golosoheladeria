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
import { Minus, Plus, StickyNote } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

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
  branch_id: string;
  name: string;
  min_select: number;
  max_select: number;
  required: boolean;
}
interface Modifier {
  id: string;
  group_id: string;
  branch_id: string;
  name: string;
  price: number;
  active: boolean;
  image_url?: string | null;
  disabled_branch_ids?: string[] | null;
}

interface Props {
  product: { id: string; name: string; price: number; modifier_group_ids: string[] } | null;
  branchId?: string | null;
  onClose: () => void;
  onConfirm: (mods: SelectedModifier[], unitExtra: number, note?: string) => void;
  initialPicked?: Record<string, number>;
  initialNote?: string;
  confirmLabel?: string;
}

export function ModifiersModal({ product, branchId, onClose, onConfirm, initialPicked, initialNote, confirmLabel }: Props) {
  const open = !!product;
  const groupIds = useMemo(() => [...(product?.modifier_group_ids ?? [])].sort(), [product?.modifier_group_ids]);

  const { data: groups = [] } = useQuery<ModifierGroup[]>({
    queryKey: ["mod-groups", branchId ?? "all", groupIds.join(",")],
    enabled: open && groupIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("modifier_groups")
        .select("id,branch_id,name,min_select,max_select,required")
        .in("id", groupIds)
        .match(branchId ? { branch_id: branchId } : {});
      return (data ?? []) as ModifierGroup[];
    },
  });
  const validGroupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const { data: modsRaw = [] } = useQuery<Modifier[]>({
    queryKey: ["mods-for", branchId ?? "all", validGroupIds.join(",")],
    enabled: open && validGroupIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("modifiers")
        .select("id,group_id,branch_id,name,price,active,image_url,disabled_branch_ids")
        .in("group_id", validGroupIds)
        .match(branchId ? { branch_id: branchId } : {})
        .eq("active", true)
        .order("name");
      return (data ?? []) as Modifier[];
    },
  });
  const mods = useMemo(
    () => modsRaw.filter((m) => !branchId || !(m.disabled_branch_ids ?? []).includes(branchId)),
    [modsRaw, branchId],
  );

  // qty per modifier id (supports repeated selection for multi groups)
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) {
      setPicked(initialPicked ? { ...initialPicked } : {});
      setNote(initialNote ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const min = g.required ? Math.max(1, g.min_select) : g.min_select;
      if (min > 0 && c < min) return `${g.name}: selecciona mínimo ${min}`;
      if (g.max_select > 0 && c > g.max_select) return `${g.name}: máximo ${g.max_select}`;
    }
    return null;
  }, [groups, countsByGroup]);

  function inc(m: Modifier, g: ModifierGroup) {
    const currentGroup = countsByGroup[g.id] ?? 0;
    if (g.max_select > 0 && currentGroup >= g.max_select) return;
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

  function setRadio(g: ModifierGroup, modId: string) {
    setPicked((prev) => {
      const next = { ...prev };
      for (const m of mods) if (m.group_id === g.id) delete next[m.id];
      next[modId] = 1;
      return next;
    });
  }
  function clearRadio(g: ModifierGroup) {
    if (g.required) return;
    setPicked((prev) => {
      const next = { ...prev };
      for (const m of mods) if (m.group_id === g.id) delete next[m.id];
      return next;
    });
  }

  function confirm() {
    if (validation) return;
    const chosen: SelectedModifier[] = mods
      .filter((m) => (picked[m.id] ?? 0) > 0)
      .map((m) => ({
        id: m.id,
        group_id: m.group_id,
        group_name: groups.find((g) => g.id === m.group_id)?.name ?? "",
        name: m.name,
        price: Number(m.price),
        qty: picked[m.id]!,
      }));
    onConfirm(chosen, unitExtra, note.trim() || undefined);
  }

  // Detect "single optional modifier" case
  const isSingleOptional =
    open && groups.length === 1 && mods.length === 1 && !groups[0].required && (groups[0].min_select ?? 0) === 0 && (groups[0].max_select ?? 1) <= 1;

  if (!product) return null;

  if (isSingleOptional) {
    const only = mods[0];
    const isChecked = (picked[only.id] ?? 0) > 0;
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
              onCheckedChange={(v) => setPicked(v ? { [only.id]: 1 } : {})}
              className="h-6 w-6 rounded-full border-2 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground"
            />
            {only.image_url && (
              <img src={only.image_url} alt={only.name} className="h-12 w-12 rounded object-cover bg-white border" loading="lazy" />
            )}
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
              {confirmLabel ?? "Agregar"} · {formatMoney(Number(product.price) + unitExtra)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
          <DialogTitle className="font-display text-2xl">{product.name}</DialogTitle>
          <DialogDescription>Personaliza tu producto.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Sin opciones configuradas.</p>
          )}
          {groups.map((g) => {
            const groupMods = mods.filter((m) => m.group_id === g.id);
            const count = countsByGroup[g.id] ?? 0;
            const isSingle = g.max_select === 1;
            const currentRadioId = groupMods.find((m) => (picked[m.id] ?? 0) > 0)?.id ?? "";
            const atMax = g.max_select > 0 && count >= g.max_select;
            const limitText = (() => {
              if (isSingle) return g.required ? "Elige 1 (obligatorio)" : "Elige 1 (opcional)";
              const parts: string[] = [];
              if (g.min_select > 0) parts.push(`mín ${g.min_select}`);
              if (g.max_select > 0) parts.push(`máx ${g.max_select}`);
              if (g.required && g.min_select === 0) parts.unshift("obligatorio");
              parts.push("puedes repetir");
              return parts.join(" · ");
            })();

            return (
              <div key={g.id} className="space-y-2">
                <div className="flex items-center justify-between border-b pb-1">
                  <div>
                    <div className="font-medium">{g.name}</div>
                    <div className="text-xs text-muted-foreground">{limitText}</div>
                  </div>
                  <Badge variant={count > 0 ? "default" : "secondary"}>
                    {g.max_select > 0 ? `${count}/${g.max_select}` : count}
                  </Badge>
                </div>

                {isSingle ? (
                  <RadioGroup value={currentRadioId} onValueChange={(v) => setRadio(g, v)} className="space-y-1.5">
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
                              if (!g.required && isChecked) setTimeout(() => clearRadio(g), 0);
                            }}
                          />
                          {m.image_url && (
                            <img src={m.image_url} alt={m.name} className="h-10 w-10 rounded object-cover bg-white border" loading="lazy" />
                          )}
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
                      const q = picked[m.id] ?? 0;
                      const isChecked = q > 0;
                      const cbId = `mod-cb-${m.id}`;
                      const canAddMore = !(g.max_select > 0 && count >= g.max_select);
                      const toggle = (checked: boolean) => {
                        if (checked) inc(m, g);
                        else setPicked((p) => { const n = { ...p }; delete n[m.id]; return n; });
                      };
                      return (
                        <li
                          key={m.id}
                          className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                            isChecked
                              ? "border-primary/70 bg-primary/5 ring-1 ring-primary/30"
                              : "border-transparent bg-muted/40 hover:bg-muted/60"
                          }`}
                        >
                          {m.image_url && (
                            <img src={m.image_url} alt={m.name} className="h-10 w-10 rounded object-cover bg-white border" loading="lazy" />
                          )}
                          <label htmlFor={cbId} className="flex-1 min-w-0 cursor-pointer">
                            <div className={`text-sm truncate ${isChecked ? "font-semibold" : "font-medium"}`}>{m.name}</div>
                            {Number(m.price) > 0 && (
                              <div className="text-xs text-muted-foreground">
                                + {formatMoney(m.price)}
                                {q > 1 && ` × ${q} = ${formatMoney(Number(m.price) * q)}`}
                              </div>
                            )}
                          </label>
                          {isChecked && g.max_select !== 1 ? (
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-8 w-8 rounded-full"
                                onClick={() => dec(m)}
                                aria-label={`Quitar ${m.name}`}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-6 text-center text-sm font-semibold tabular-nums">{q}</span>
                              <Button
                                size="icon"
                                className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                                disabled={!canAddMore}
                                onClick={() => inc(m, g)}
                                aria-label={`Agregar ${m.name}`}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <Checkbox
                              id={cbId}
                              checked={isChecked}
                              onCheckedChange={(v) => toggle(!!v)}
                              disabled={!isChecked && !canAddMore}
                              className="h-6 w-6 rounded-full border-2 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground"
                            />
                          )}
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

          <div className="space-y-2">
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
        </div>

        <DialogFooter className="shrink-0 flex-col sm:flex-row gap-2 border-t bg-background/95 backdrop-blur px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)]">
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
            {confirmLabel ?? "Agregar"} · {formatMoney(Number(product.price) + unitExtra)}
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
