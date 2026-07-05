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
import { BarChart3, Layers, TrendingUp, Package } from "lucide-react";
import { useBranch } from "@/contexts/branch-context";

export const Route = createFileRoute("/_authenticated/estadisticas")({
  head: () => ({ meta: [{ title: "Estadísticas · Goloso POS" }] }),
  component: EstadisticasPage,
});

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

type ModifierRow = {
  key: string;
  name: string;
  group_name: string | null;
  uses: number;
  qty_total: number;
  amount_total: number;
};

type RawMod = {
  id?: string;
  name?: string;
  group_name?: string;
  price?: number | string;
  qty?: number | string;
};

function EstadisticasPage() {
  const { activeBranchId, activeBranch } = useBranch();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [includeZero, setIncludeZero] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["modifier-stats", activeBranchId, from, to],
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
      if (saleIds.length === 0) return { rows: [] as ModifierRow[], salesCount: 0 };

      const chunks: string[][] = [];
      for (let i = 0; i < saleIds.length; i += 500) chunks.push(saleIds.slice(i, i + 500));
      const itemsAll: { qty: number; modifiers: unknown }[] = [];
      for (const c of chunks) {
        const { data: items } = await supabase
          .from("sale_items")
          .select("qty,modifiers")
          .in("sale_id", c);
        for (const it of items ?? []) {
          itemsAll.push({ qty: Number(it.qty ?? 0), modifiers: it.modifiers });
        }
      }

      const map = new Map<string, ModifierRow>();
      for (const it of itemsAll) {
        const mods = Array.isArray(it.modifiers) ? (it.modifiers as RawMod[]) : [];
        for (const m of mods) {
          const name = (m?.name ?? "").toString().trim() || "—";
          // Agrupar únicamente por nombre del modificador (sin importar el grupo).
          const key = name.toLowerCase();
          const modQty = Number(m?.qty ?? 1) || 1;
          const price = Number(m?.price ?? 0) || 0;
          const totalQty = modQty * it.qty;
          const cur = map.get(key) ?? { key, name, group_name: null, uses: 0, qty_total: 0, amount_total: 0 };
          cur.uses += 1;
          cur.qty_total += totalQty;
          cur.amount_total += totalQty * price;
          map.set(key, cur);
        }
      }
      const rows = Array.from(map.values()).sort((a, b) => b.uses - a.uses);
      return { rows, salesCount: saleIds.length };
    },
  });

  const { data: allModifiers } = useQuery({
    queryKey: ["all-modifiers-catalog"],
    enabled: includeZero,
    queryFn: async () => {
      const { data } = await supabase
        .from("modifiers")
        .select("id,name,group_id,price,modifier_groups(name)");
      return (data ?? []) as unknown as { id: string; name: string; price: number; modifier_groups: { name: string } | null }[];
    },
  });

  const rows = useMemo<ModifierRow[]>(() => {
    const base = data?.rows ?? [];
    if (!includeZero) return base;
    const seen = new Set(base.map((r) => r.key));
    const extrasMap = new Map<string, ModifierRow>();
    for (const m of allModifiers ?? []) {
      const name = (m.name ?? "").trim() || "—";
      const key = name.toLowerCase();
      if (seen.has(key) || extrasMap.has(key)) continue;
      extrasMap.set(key, { key, name, group_name: null, uses: 0, qty_total: 0, amount_total: 0 });
    }
    return [...base, ...Array.from(extrasMap.values())];
  }, [data, includeZero, allModifiers]);

  const totals = useMemo(
    () => ({
      distinct: rows.filter((r) => r.uses > 0).length,
      uses: rows.reduce((s, r) => s + r.uses, 0),
      qty: rows.reduce((s, r) => s + r.qty_total, 0),
      amount: rows.reduce((s, r) => s + r.amount_total, 0),
    }),
    [rows],
  );

  const setToday = () => {
    const d = todayISO();
    setFrom(d);
    setTo(d);
  };
  const setYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    setFrom(iso);
    setTo(iso);
  };
  const setLast7 = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  };
  const setThisMonth = () => {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Estadísticas</h1>
        <p className="text-muted-foreground">
          Movimientos de modificadores · <span className="font-medium text-foreground">{activeBranch?.name ?? "—"}</span>
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 font-display text-xl font-extrabold uppercase tracking-wide">
            <Layers className="h-5 w-5 text-primary" /> Movimientos de Modificadores
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
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
              <label htmlFor="zero" className="text-sm">Mostrar con cero movimientos</label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <MiniCard icon={<Layers className="h-4 w-4" />} label="Modificadores distintos" value={totals.distinct.toString()} />
            <MiniCard icon={<BarChart3 className="h-4 w-4" />} label="Total de usos" value={totals.uses.toString()} />
            <MiniCard icon={<Package className="h-4 w-4" />} label="Cantidad total vendida" value={totals.qty.toString()} />
            <MiniCard icon={<TrendingUp className="h-4 w-4" />} label="Valor total generado" value={formatMoney(totals.amount)} />
          </div>

          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modificador</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead className="text-right">Usos</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Valor generado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5}><Skeleton className="h-24" /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      Sin movimientos de modificadores en el período seleccionado.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.group_name ?? "—"}</TableCell>
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
