import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChefHat, Plus, Trash2, Save, Search, CheckCircle2, Circle, Info } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/menu/recetas")({
  head: () => ({ meta: [{ title: "Recetas · Goloso POS" }] }),
  component: RecetasPage,
});

type RecipeLine = { supply_id: string; qty: number };
interface Product { id: string; name: string; price: number; image_url: string | null; recipe: RecipeLine[] | null; }
interface Supply { id: string; name: string; unit: string; cost: number; }

function RecetasPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products-recetas"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id,name,price,image_url,recipe").eq("active", true).order("name");
      return (data as any) ?? [];
    },
  });
  const { data: supplies = [] } = useQuery<Supply[]>({
    queryKey: ["supplies-recetas"],
    queryFn: async () => {
      const { data } = await supabase.from("supplies").select("id,name,unit,cost").order("name");
      return (data as any) ?? [];
    },
  });

  const supplyMap = useMemo(() => new Map(supplies.map((s) => [s.id, s])), [supplies]);
  const filtered = useMemo(
    () => products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())),
    [products, search],
  );
  const selected = products.find((p) => p.id === selectedId) ?? null;

  function selectProduct(p: Product) {
    setSelectedId(p.id);
    setLines(Array.isArray(p.recipe) ? p.recipe : []);
    setDirty(false);
  }

  function addLine() {
    setLines((prev) => [...prev, { supply_id: "", qty: 1 }]);
    setDirty(true);
  }
  function updateLine(i: number, patch: Partial<RecipeLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
    setDirty(true);
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  async function save() {
    if (!selected) return;
    const clean = lines.filter((l) => l.supply_id && Number(l.qty) > 0).map((l) => ({ supply_id: l.supply_id, qty: Number(l.qty) }));
    const payload = clean.length ? clean : null;
    const { error } = await supabase.from("products").update({ recipe: payload as any }).eq("id", selected.id);
    if (error) return toast.error(error.message);
    toast.success("Receta guardada");
    setDirty(false);
    qc.invalidateQueries({ queryKey: ["products-recetas"] });
  }

  async function clearRecipe() {
    if (!selected) return;
    if (!confirm("¿Quitar la receta de este producto?")) return;
    const { error } = await supabase.from("products").update({ recipe: null }).eq("id", selected.id);
    if (error) return toast.error(error.message);
    setLines([]); setDirty(false);
    toast.success("Receta eliminada");
    qc.invalidateQueries({ queryKey: ["products-recetas"] });
  }

  const costTotal = lines.reduce((acc, l) => {
    const s = supplyMap.get(l.supply_id);
    return acc + (s ? Number(s.cost) * Number(l.qty || 0) : 0);
  }, 0);

  const withRecipe = products.filter((p) => Array.isArray(p.recipe) && p.recipe.length).length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <ChefHat className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Recetas</h1>
          <p className="text-sm text-muted-foreground">
            Define insumos por producto para descontar inventario automáticamente. Es <b>opcional</b>: agrégalas poco a poco.
          </p>
        </div>
        <Badge variant="secondary" className="ml-auto">{withRecipe}/{products.length} con receta</Badge>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 text-sm flex gap-2 items-start">
        <Info className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <p>Los productos sin receta funcionan normalmente. Solo los productos con receta descontarán insumos del inventario al vender.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Products list */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Productos</CardTitle>
            <div className="relative mt-2">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…" className="pl-8" />
            </div>
          </CardHeader>
          <CardContent className="max-h-[70vh] overflow-y-auto space-y-1">
            {filtered.map((p) => {
              const hasRecipe = Array.isArray(p.recipe) && p.recipe.length > 0;
              return (
                <button
                  key={p.id}
                  onClick={() => selectProduct(p)}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                    selectedId === p.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted"
                  }`}
                >
                  {hasRecipe ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="flex-1 text-sm">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{formatMoney(p.price)}</span>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="text-sm text-muted-foreground p-2">Sin resultados</p>}
          </CardContent>
        </Card>

        {/* Editor */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selected ? `Receta de: ${selected.name}` : "Selecciona un producto"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selected ? (
              <p className="text-sm text-muted-foreground">Elige un producto de la izquierda para definir o editar su receta.</p>
            ) : (
              <>
                {lines.length === 0 && (
                  <p className="text-sm text-muted-foreground">Este producto aún no tiene receta. Agrega insumos cuando estés listo.</p>
                )}
                <div className="space-y-2">
                  {lines.map((line, i) => {
                    const s = supplyMap.get(line.supply_id);
                    return (
                      <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                        <Select value={line.supply_id} onValueChange={(v) => updateLine(i, { supply_id: v })}>
                          <SelectTrigger className="min-w-[220px] flex-1"><SelectValue placeholder="Insumo…" /></SelectTrigger>
                          <SelectContent>
                            {supplies.map((sp) => (
                              <SelectItem key={sp.id} value={sp.id}>{sp.name} ({sp.unit})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number" step="0.01" min="0"
                          className="w-28"
                          value={line.qty}
                          onChange={(e) => updateLine(i, { qty: Number(e.target.value) })}
                        />
                        <span className="text-xs text-muted-foreground w-16">{s?.unit ?? ""}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {s ? formatMoney(Number(s.cost) * Number(line.qty || 0)) : ""}
                        </span>
                        <Button size="icon" variant="ghost" onClick={() => removeLine(i)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="outline" onClick={addLine}><Plus className="h-4 w-4 mr-1" /> Añadir insumo</Button>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">Costo estimado: <b>{formatMoney(costTotal)}</b></span>
                    {selected.recipe && (
                      <Button variant="ghost" className="text-destructive" onClick={clearRecipe}>Quitar receta</Button>
                    )}
                    <Button onClick={save} disabled={!dirty}>
                      <Save className="h-4 w-4 mr-1" /> Guardar
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
