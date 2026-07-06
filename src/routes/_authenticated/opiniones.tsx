import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, MessageSquareHeart } from "lucide-react";
import { useBranch } from "@/contexts/branch-context";

export const Route = createFileRoute("/_authenticated/opiniones")({
  head: () => ({ meta: [{ title: "Opiniones de clientes · Goloso POS" }] }),
  component: OpinionesPage,
});

const EMOJIS: Record<number, { emoji: string; label: string; color: string }> = {
  1: { emoji: "😡", label: "Muy malo", color: "text-red-500" },
  2: { emoji: "🙁", label: "Malo", color: "text-orange-500" },
  3: { emoji: "😐", label: "Regular", color: "text-yellow-500" },
  4: { emoji: "😊", label: "Bueno", color: "text-lime-500" },
  5: { emoji: "🤩", label: "Excelente", color: "text-emerald-500" },
};

interface FeedbackRow {
  id: string;
  rating: number;
  branch_id: string | null;
  sale_id: string | null;
  source: string;
  created_at: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

function OpinionesPage() {
  const { activeBranchId, branches } = useBranch();
  const [range, setRange] = useState<"today" | "7d" | "30d" | "all">("7d");

  const since = useMemo(() => {
    const now = new Date();
    if (range === "today") { now.setHours(0, 0, 0, 0); return now.toISOString(); }
    if (range === "7d") return new Date(Date.now() - 7 * 86400000).toISOString();
    if (range === "30d") return new Date(Date.now() - 30 * 86400000).toISOString();
    return null;
  }, [range]);

  const { data: rows = [], isLoading } = useQuery<FeedbackRow[]>({
    queryKey: ["kiosk-feedback", activeBranchId, since],
    refetchInterval: 15000,
    queryFn: async () => {
      let q = supabase
        .from("kiosk_feedback")
        .select("id,rating,branch_id,sale_id,source,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      if (since) q = q.gte("created_at", since);
      const { data } = await q;
      return (data ?? []) as FeedbackRow[];
    },
  });

  const total = rows.length;
  const avg = total ? rows.reduce((a, r) => a + r.rating, 0) / total : 0;
  const counts = [1, 2, 3, 4, 5].map((n) => ({
    n,
    count: rows.filter((r) => r.rating === n).length,
  }));
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "—";

  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-8">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <MessageSquareHeart className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight truncate">
              Opiniones de clientes
            </h1>
            <p className="text-sm text-muted-foreground truncate">
              Calificaciones enviadas desde el autopedido / kiosko
            </p>
          </div>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as typeof range)}>
          <SelectTrigger className="w-[150px] shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoy</SelectItem>
            <SelectItem value="7d">Últimos 7 días</SelectItem>
            <SelectItem value="30d">Últimos 30 días</SelectItem>
            <SelectItem value="all">Todo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-semibold uppercase">Total opiniones</div>
            <div className="mt-1 font-display text-3xl font-extrabold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-semibold uppercase">Promedio</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-display text-3xl font-extrabold">{avg.toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">/ 5</span>
            </div>
            <div className="flex items-center gap-0.5 mt-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={`h-4 w-4 ${n <= Math.round(avg) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"}`} />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-2">
          <CardContent className="p-4 space-y-1.5">
            {counts.slice().reverse().map(({ n, count }) => {
              const pct = total ? (count / total) * 100 : 0;
              return (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 flex items-center gap-1 font-semibold">
                    <span>{EMOJIS[n].emoji}</span>
                    <span>{n}★</span>
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-10 text-right text-muted-foreground">{count}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Últimas opiniones</CardTitle>
          <CardDescription>Registro cronológico de calificaciones de clientes.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : rows.length === 0 ? (
            <div className="p-14 text-center text-muted-foreground">
              <MessageSquareHeart className="mx-auto h-10 w-10 mb-3 opacity-40" />
              <p className="font-medium">Sin opiniones todavía</p>
              <p className="text-sm">Aparecerán aquí en cuanto los clientes califiquen desde el kiosko.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => {
                const meta = EMOJIS[r.rating] ?? EMOJIS[3];
                return (
                  <li key={r.id} className="flex items-center gap-4 p-4">
                    <div className="text-4xl leading-none">{meta.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-bold ${meta.color}`}>{meta.label}</span>
                        <Badge variant="secondary" className="text-[10px]">{r.rating}★</Badge>
                        <Badge variant="outline" className="text-[10px] uppercase">{r.source}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {formatDate(r.created_at)} · {branchName(r.branch_id)}
                        {r.sale_id ? ` · pedido ${r.sale_id.slice(0, 8)}` : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
