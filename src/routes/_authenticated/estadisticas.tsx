import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { BarChart3, Layers, TrendingUp, Package, Tag } from "lucide-react";
import { useBranch } from "@/contexts/branch-context";

export const Route = createFileRoute("/_authenticated/estadisticas")({
  head: () => ({ meta: [{ title: "Estadísticas · Goloso POS" }] }),
  component: EstadisticasPage,
});

function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayISO() {
  return toLocalISO(new Date());
}

type CategoryRow = { key: string; name: string; qty: number; amount: number };
type ProductRow = { key: string; name: string; category: string; qty: number; amount: number };
type ModifierRow = { key: string; name: string; uses: number; qty_total: number; amount_total: number };

type RawMod = { name?: string; price?: number | string; qty?: number | string };

function EstadisticasPage() {
  const { activeBranchId, activeBranch } = useBranch();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [includeZero, setIncludeZero] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["stats-all", activeBranchId, from, to],
    enabled: !!activeBranchId,
    queryFn: async () => {
      const startIso = new Date(`${from}T00:00:00`).toISOString();
      const endDate = new Date(`${to}T00:00:00`);
      endDate.setDate(endDate.getDate() + 1);
      const endIso = endDate.toISOString();

      const { data: sales } = await supabase
        .from("sales")
        .select("id")
        .eq("branch_id", activeBranchId!)
        .neq("status", "cancelled")
        .gte("created_at", startIso)
        .lt("created_at", endIso);
      const saleIds = (sales ?? []).map((s) => s.id);
      if (saleIds.length === 0) {
        return { cats: [] as CategoryRow[], prods: [] as ProductRow[], mods: [] as ModifierRow[], salesCount: 0 };
      }

      const chunks: string[][] = [];
      for (let i = 0; i < saleIds.length; i += 500) chunks.push(saleIds.slice(i, i + 500));
      const itemsAll: { product_id: string | null; product_name: string; qty: number; unit_price: number; subtotal: number | null; modifiers: unknown }[] = [];
      for (const c of chunks) {
        const { data: items } = await supabase
          .from("sale_items")
          .select("product_id,product_name,qty,unit_price,subtotal,modifiers")
          .in("sale_id", c);
        for (const it of items ?? []) {
          itemsAll.push({
            product_id: it.product_id,
            product_name: (it.product_name ?? "").toString(),
            qty: Number(it.qty ?? 0),
            unit_price: Number(it.unit_price ?? 0),
            subtotal: it.subtotal == null ? null : Number(it.subtotal),
            modifiers: it.modifiers,
          });
        }
      }

      // Enriquecer con producto → categoría
      const productIds = Array.from(new Set(itemsAll.map((i) => i.product_id).filter((x): x is string => !!x)));
      const catByProduct = new Map<string, { category: string }>();
      if (productIds.length > 0) {
        const prodChunks: string[][] = [];
        for (let i = 0; i < productIds.length; i += 500) prodChunks.push(productIds.slice(i, i + 500));
        for (const c of prodChunks) {
          const { data: prods } = await supabase
            .from("products")
            .select("id,category:categories(name)")
            .in("id", c);
          for (const p of prods ?? []) {
            const category = (p.category as { name?: string } | null)?.name ?? "Sin categoría";
            catByProduct.set(p.id as string, { category });
          }
        }
      }

      const catMap = new Map<string, CategoryRow>();
      const prodMap = new Map<string, ProductRow>();
      const modMap = new Map<string, ModifierRow>();

      for (const it of itemsAll) {
        const lineAmount = it.subtotal != null ? it.subtotal : it.qty * it.unit_price;
        const category = (it.product_id && catByProduct.get(it.product_id)?.category) || "Sin categoría";
        // Categoría
        const cKey = category.toLowerCase();
        const c = catMap.get(cKey) ?? { key: cKey, name: category, qty: 0, amount: 0 };
        c.qty += it.qty;
        c.amount += lineAmount;
        catMap.set(cKey, c);
        // Producto
        const pKey = (it.product_id ?? it.product_name).toLowerCase();
        const p = prodMap.get(pKey) ?? { key: pKey, name: it.product_name || "—", category, qty: 0, amount: 0 };
        p.qty += it.qty;
        p.amount += lineAmount;
        prodMap.set(pKey, p);
        // Modificadores
        const mods = Array.isArray(it.modifiers) ? (it.modifiers as RawMod[]) : [];
        for (const m of mods) {
          const name = (m?.name ?? "").toString().trim() || "—";
          const mKey = name.toLowerCase();
          const modQty = Number(m?.qty ?? 1) || 1;
          const price = Number(m?.price ?? 0) || 0;
          const totalQty = modQty * it.qty;
          const cur = modMap.get(mKey) ?? { key: mKey, name, uses: 0, qty_total: 0, amount_total: 0 };
          cur.uses += 1;
          cur.qty_total += totalQty;
          cur.amount_total += totalQty * price;
          modMap.set(mKey, cur);
        }
      }

      const cats = Array.from(catMap.values()).sort((a, b) => b.amount - a.amount);
      const prods = Array.from(prodMap.values()).sort((a, b) => b.amount - a.amount);
      const mods = Array.from(modMap.values()).sort((a, b) => b.uses - a.uses);
      return { cats, prods, mods, salesCount: saleIds.length };
    },
  });

  const { data: allModifiers } = useQuery({
    queryKey: ["all-modifiers-catalog"],
    enabled: includeZero,
    queryFn: async () => {
      const { data } = await supabase.from("modifiers").select("id,name");
      return (data ?? []) as unknown as { id: string; name: string }[];
    },
  });

  const modRows = useMemo<ModifierRow[]>(() => {
    const base = data?.mods ?? [];
    if (!includeZero) return base;
    const seen = new Set(base.map((r) => r.key));
    const extras: ModifierRow[] = [];
    for (const m of allModifiers ?? []) {
      const name = (m.name ?? "").trim() || "—";
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      extras.push({ key, name, uses: 0, qty_total: 0, amount_total: 0 });
    }
    return [...base, ...extras];
  }, [data, includeZero, allModifiers]);

  const catTotals = useMemo(
    () => ({
      count: (data?.cats ?? []).length,
      qty: (data?.cats ?? []).reduce((s, r) => s + r.qty, 0),
      amount: (data?.cats ?? []).reduce((s, r) => s + r.amount, 0),
    }),
    [data],
  );
  const prodTotals = useMemo(
    () => ({
      count: (data?.prods ?? []).length,
      qty: (data?.prods ?? []).reduce((s, r) => s + r.qty, 0),
      amount: (data?.prods ?? []).reduce((s, r) => s + r.amount, 0),
    }),
    [data],
  );
  const modTotals = useMemo(
    () => ({
      distinct: modRows.filter((r) => r.uses > 0).length,
      uses: modRows.reduce((s, r) => s + r.uses, 0),
      qty: modRows.reduce((s, r) => s + r.qty_total, 0),
      amount: modRows.reduce((s, r) => s + r.amount_total, 0),
    }),
    [modRows],
  );

  const setToday = () => { const d = todayISO(); setTo(d); setFrom(d); };
  const setYesterday = () => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const iso = toLocalISO(d); setTo(iso); setFrom(iso);
  };
  const setLast7 = () => {
    const end = new Date();
    const start = new Date(); start.setDate(end.getDate() - 6);
    const endIso = toLocalISO(end);
    const startIso = toLocalISO(start);
    setTo(endIso); setFrom(startIso);
  };
  const setThisMonth = () => {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    const endIso = toLocalISO(end);
    const startIso = toLocalISO(start);
    setTo(endIso); setFrom(startIso);
  };


  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Estadísticas</h1>
        <p className="text-muted-foreground">
          Ventas por categoría, producto y modificadores · <span className="font-medium text-foreground">{activeBranch?.name ?? "—"}</span>
        </p>
      </div>

      {/* Filtros globales */}
      <Card className="rounded-2xl">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Desde</label>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Hasta</label>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={setToday}>Hoy</Button>
            <Button size="sm" variant="outline" onClick={setYesterday}>Ayer</Button>
            <Button size="sm" variant="outline" onClick={setLast7}>Últimos 7 días</Button>
            <Button size="sm" variant="outline" onClick={setThisMonth}>Este mes</Button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Switch id="zero" checked={includeZero} onCheckedChange={setIncludeZero} />
            <label htmlFor="zero" className="text-sm">Mostrar modificadores con cero</label>
          </div>
        </CardContent>
      </Card>

      {/* 1. POR CATEGORÍA */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 font-display text-xl font-extrabold uppercase tracking-wide">
            <Tag className="h-5 w-5 text-primary" /> Por Categoría
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniCard icon={<Tag className="h-4 w-4" />} label="Categorías" value={catTotals.count.toString()} />
            <MiniCard icon={<Package className="h-4 w-4" />} label="Unidades" value={catTotals.qty.toString()} />
            <MiniCard icon={<TrendingUp className="h-4 w-4" />} label="Valor total" value={formatMoney(catTotals.amount)} />
          </div>
          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Categoría</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={3}><Skeleton className="h-24" /></TableCell></TableRow>
                ) : (data?.cats ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Sin ventas en el período seleccionado.</TableCell></TableRow>
                ) : (
                  (data?.cats ?? []).map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right font-mono">{r.qty}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(r.amount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 2. POR PRODUCTOS */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 font-display text-xl font-extrabold uppercase tracking-wide">
            <Package className="h-5 w-5 text-primary" /> Por Productos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniCard icon={<Package className="h-4 w-4" />} label="Productos" value={prodTotals.count.toString()} />
            <MiniCard icon={<BarChart3 className="h-4 w-4" />} label="Unidades" value={prodTotals.qty.toString()} />
            <MiniCard icon={<TrendingUp className="h-4 w-4" />} label="Valor total" value={formatMoney(prodTotals.amount)} />
          </div>
          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead>Categoría</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4}><Skeleton className="h-24" /></TableCell></TableRow>
                ) : (data?.prods ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Sin ventas en el período seleccionado.</TableCell></TableRow>
                ) : (
                  (data?.prods ?? []).map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.category}</TableCell>
                      <TableCell className="text-right font-mono">{r.qty}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(r.amount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 3. POR MODIFICADORES */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 font-display text-xl font-extrabold uppercase tracking-wide">
            <Layers className="h-5 w-5 text-primary" /> Por Modificadores
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <MiniCard icon={<Layers className="h-4 w-4" />} label="Modificadores" value={modTotals.distinct.toString()} />
            <MiniCard icon={<BarChart3 className="h-4 w-4" />} label="Usos" value={modTotals.uses.toString()} />
            <MiniCard icon={<Package className="h-4 w-4" />} label="Cantidad" value={modTotals.qty.toString()} />
            <MiniCard icon={<TrendingUp className="h-4 w-4" />} label="Valor generado" value={formatMoney(modTotals.amount)} />
          </div>
          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Modificador</TableHead><TableHead className="text-right">Usos</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">Valor generado</TableHead></TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4}><Skeleton className="h-24" /></TableCell></TableRow>
                ) : modRows.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Sin movimientos de modificadores en el período seleccionado.</TableCell></TableRow>
                ) : (
                  modRows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right font-mono">{r.uses}</TableCell>
                      <TableCell className="text-right font-mono">{r.qty_total}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(r.amount_total)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MiniCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </div>
      <div className="mt-1 font-display text-2xl font-extrabold">{value}</div>
    </div>
  );
}
