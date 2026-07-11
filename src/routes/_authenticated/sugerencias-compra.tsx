import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Download, MessageCircle, Copy, PackageX, AlertTriangle, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sugerencias-compra")({
  head: () => ({ meta: [{ title: "Sugerencias de compra · Goloso POS" }] }),
  component: SugerenciasComprasPage,
});

interface Row {
  id: string;
  name: string;
  unit?: string | null;
  stock: number;
  min_stock: number;
  suggested: number;
  status: "out" | "low";
}

function suggestedQty(stock: number, min: number) {
  const target = Math.max(min * 2, min + 1);
  const need = target - stock;
  return Math.max(1, Math.ceil(need));
}

function SugerenciasComprasPage() {
  const { activeBranchId, activeBranch } = useBranch();
  const [qtyOverride, setQtyOverride] = useState<Record<string, number>>({});

  const { data: products = [], isLoading: lp } = useQuery({
    queryKey: ["sug-products", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,stock,min_stock,track_stock,active,available_branch_ids")
        .eq("active", true)
        .eq("track_stock", true)
        .order("name");
      return (data ?? []).filter(
        (p) => !p.available_branch_ids?.length || p.available_branch_ids.includes(activeBranchId!),
      );
    },
  });

  const { data: supplies = [], isLoading: ls } = useQuery({
    queryKey: ["sug-supplies"],
    queryFn: async () =>
      (await supabase.from("supplies").select("id,name,unit,stock,min_stock").order("name")).data ?? [],
  });

  const productRows = useMemo<Row[]>(
    () =>
      products
        .map((p): Row | null => {
          const s = Number(p.stock ?? 0);
          const m = Number(p.min_stock ?? 0);
          if (m <= 0 && s > 0) return null;
          if (s > m) return null;
          return {
            id: p.id,
            name: p.name,
            stock: s,
            min_stock: m,
            suggested: suggestedQty(s, m),
            status: s <= 0 ? "out" : "low",
          };
        })
        .filter((x): x is Row => x !== null),
    [products],
  );

  const supplyRows = useMemo<Row[]>(
    () =>
      supplies
        .map((p): Row | null => {
          const s = Number(p.stock ?? 0);
          const m = Number(p.min_stock ?? 0);
          if (m <= 0 && s > 0) return null;
          if (s > m) return null;
          return {
            id: p.id,
            name: p.name,
            unit: p.unit,
            stock: s,
            min_stock: m,
            suggested: suggestedQty(s, m),
            status: s <= 0 ? "out" : "low",
          };
        })
        .filter((x): x is Row => x !== null),
    [supplies],
  );

  function qty(row: Row) {
    return qtyOverride[row.id] ?? row.suggested;
  }

  function buildText(title: string, rows: Row[]) {
    const lines = [
      `*${title}*`,
      `Sede: ${activeBranch?.name ?? "—"}`,
      `Fecha: ${new Date().toLocaleDateString()}`,
      "",
      ...rows.map((r, i) => {
        const unit = r.unit ? ` ${r.unit}` : "";
        const tag = r.status === "out" ? "🚨 AGOTADO" : "⚠️ Bajo";
        return `${i + 1}. ${r.name} — ${qty(r)}${unit}  (stock ${r.stock}${unit}, mín ${r.min_stock}${unit}) ${tag}`;
      }),
    ];
    return lines.join("\n");
  }

  function copyText(title: string, rows: Row[]) {
    if (rows.length === 0) return toast.info("Nada para copiar");
    navigator.clipboard.writeText(buildText(title, rows));
    toast.success("Lista copiada al portapapeles");
  }

  function openWhatsApp(title: string, rows: Row[]) {
    if (rows.length === 0) return toast.info("Nada para enviar");
    const text = encodeURIComponent(buildText(title, rows));
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }

  function exportCSV(title: string, rows: Row[]) {
    if (rows.length === 0) return toast.info("Nada para exportar");
    const header = "Nombre,Stock,Mínimo,Sugerido,Unidad,Estado";
    const body = rows
      .map((r) =>
        [
          `"${r.name.replace(/"/g, '""')}"`,
          r.stock,
          r.min_stock,
          qty(r),
          r.unit ?? "",
          r.status === "out" ? "Agotado" : "Bajo",
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderTable(rows: Row[]) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead className="text-right">Mínimo</TableHead>
            <TableHead className="w-28 text-right">A comprar</TableHead>
            <TableHead className="w-24">Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className={r.status === "out" ? "bg-destructive/5" : "bg-amber-500/5"}>
              <TableCell className="font-medium">
                {r.name}
                {r.unit && <span className="text-xs text-muted-foreground ml-1">({r.unit})</span>}
              </TableCell>
              <TableCell className="text-right font-mono">{r.stock}</TableCell>
              <TableCell className="text-right font-mono text-muted-foreground">{r.min_stock}</TableCell>
              <TableCell>
                <Input
                  type="number"
                  className="h-8 text-right"
                  value={qty(r)}
                  onChange={(e) =>
                    setQtyOverride((p) => ({ ...p, [r.id]: Math.max(0, Number(e.target.value) || 0) }))
                  }
                />
              </TableCell>
              <TableCell>
                {r.status === "out" ? (
                  <Badge variant="destructive" className="gap-1"><PackageX className="h-3 w-3" />Agotado</Badge>
                ) : (
                  <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 gap-1">
                    <AlertTriangle className="h-3 w-3" />Bajo
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                ✅ Todo en orden. Ningún ítem por debajo del mínimo.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    );
  }

  const productsTitle = "Lista de compra - Productos";
  const suppliesTitle = "Lista de compra - Insumos";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl flex items-center gap-2">
            <ShoppingCart className="h-7 w-7" />Sugerencias de compra
          </h1>
          <p className="text-sm text-muted-foreground">
            Basado en el stock mínimo configurado para <b>{activeBranch?.name ?? "—"}</b>. Exporta o envía a tu proveedor.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/compras"><ShoppingBag className="h-4 w-4" />Registrar compra</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">Productos ({productRows.length})</CardTitle>
            <CardDescription>Productos activos con seguimiento de stock por debajo del mínimo.</CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => copyText(productsTitle, productRows)}>
              <Copy className="h-4 w-4" />Copiar
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportCSV(productsTitle, productRows)}>
              <Download className="h-4 w-4" />CSV
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => openWhatsApp(productsTitle, productRows)}>
              <MessageCircle className="h-4 w-4" />WhatsApp
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {lp ? <div className="p-8 text-center text-muted-foreground">Cargando…</div> : renderTable(productRows)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">Insumos ({supplyRows.length})</CardTitle>
            <CardDescription>Insumos por debajo del mínimo (materias primas y consumibles).</CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => copyText(suppliesTitle, supplyRows)}>
              <Copy className="h-4 w-4" />Copiar
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportCSV(suppliesTitle, supplyRows)}>
              <Download className="h-4 w-4" />CSV
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => openWhatsApp(suppliesTitle, supplyRows)}>
              <MessageCircle className="h-4 w-4" />WhatsApp
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {ls ? <div className="p-8 text-center text-muted-foreground">Cargando…</div> : renderTable(supplyRows)}
        </CardContent>
      </Card>
    </div>
  );
}
