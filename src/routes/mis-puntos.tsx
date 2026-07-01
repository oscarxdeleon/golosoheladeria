import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Gift, Star, TrendingUp, Search, Phone } from "lucide-react";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/mis-puntos")({
  head: () => ({
    meta: [
      { title: "Mis Puntos · Goloso Club" },
      { name: "description", content: "Consulta tus puntos acumulados con solo tu número de teléfono." },
    ],
  }),
  component: MisPuntosPage,
});

interface LoyaltyResult {
  found: boolean;
  error?: string;
  customer?: { name: string; phone: string; points: number; visits: number; total_spent: number; last_order_at: string | null };
  redeemable?: { points: number; money: number; min_redeem: number; point_value: number };
  recent_orders?: Array<{ ticket: number; total: number; created_at: string; points_earned: number }>;
  config?: { point_value: number; min_redeem: number; per_1000: number; welcome: string };
}

function MisPuntosPage() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LoyaltyResult | null>(null);

  async function search() {
    const clean = phone.replace(/\D/g, "");
    if (clean.length < 7) return toast.error("Ingresa un número de teléfono válido");
    setLoading(true);
    const { data, error } = await supabase.rpc("lookup_customer_loyalty", { _phone: clean });
    setLoading(false);
    if (error) return toast.error(error.message);
    setResult(data as unknown as LoyaltyResult);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 via-background to-background p-4">
      <div className="max-w-2xl mx-auto space-y-4 py-8">
        <div className="text-center space-y-2">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/20">
            <Gift className="h-9 w-9 text-primary" />
          </div>
          <h1 className="font-display text-3xl md:text-4xl">Goloso Club</h1>
          <p className="text-muted-foreground">Consulta tus puntos con solo tu teléfono</p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-12 text-lg"
                  placeholder="Tu número de celular"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                  inputMode="tel"
                />
              </div>
              <Button size="lg" onClick={search} disabled={loading}>
                <Search className="h-5 w-5 mr-1" /> {loading ? "..." : "Consultar"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {result && !result.found && (
          <Card className="border-amber-400">
            <CardContent className="py-6 text-center space-y-2">
              <div className="font-medium">
                {result.error ?? "Aún no tienes puntos con este número"}
              </div>
              {!result.error && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Haz tu primera compra y empezarás a acumular. Cada $1.000 gastados = {result.config?.per_1000 ?? 1} punto(s).
                  </p>
                  {result.config?.welcome && (
                    <p className="text-sm italic mt-2">{result.config.welcome}</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {result?.found && result.customer && (
          <>
            <Card className="border-primary border-2">
              <CardHeader className="pb-2">
                <div className="text-xs uppercase text-muted-foreground">Hola</div>
                <CardTitle className="text-2xl">{result.customer.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground p-6 text-center">
                  <div className="text-sm uppercase tracking-wider opacity-90">Tus puntos</div>
                  <div className="text-6xl font-display my-2">{result.customer.points}</div>
                  <div className="text-sm opacity-90">
                    Equivalen a <b>{formatMoney(result.customer.points * (result.redeemable?.point_value ?? 0))}</b>
                  </div>
                </div>

                {result.redeemable && result.redeemable.points > 0 ? (
                  <div className="mt-4 rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900 text-center">
                    ✨ ¡Puedes canjear <b>{formatMoney(result.redeemable.money)}</b> en tu próxima compra!
                    <div className="text-xs opacity-70 mt-1">Pídelo en caja mostrando tu número.</div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-md bg-muted p-3 text-sm text-center text-muted-foreground">
                    Necesitas <b>{(result.redeemable?.min_redeem ?? 0) - result.customer.points}</b> puntos más para canjear.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="rounded-md border p-3 text-center">
                    <div className="text-xs text-muted-foreground uppercase">Visitas</div>
                    <div className="text-2xl font-display flex items-center justify-center gap-1">
                      <Star className="h-5 w-5 text-amber-500" /> {result.customer.visits}
                    </div>
                  </div>
                  <div className="rounded-md border p-3 text-center">
                    <div className="text-xs text-muted-foreground uppercase">Gasto total</div>
                    <div className="text-lg font-mono flex items-center justify-center gap-1">
                      <TrendingUp className="h-4 w-4 text-emerald-500" /> {formatMoney(result.customer.total_spent)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {result.recent_orders && result.recent_orders.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Últimas compras</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {result.recent_orders.map((o) => (
                    <div key={o.ticket} className="flex items-center justify-between border-b pb-2 last:border-0">
                      <div>
                        <div className="font-medium">#{o.ticket}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(o.created_at)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono">{formatMoney(o.total)}</div>
                        <div className="text-xs text-emerald-600">+{o.points_earned} pts</div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
