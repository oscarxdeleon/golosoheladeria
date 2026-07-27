import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatDate } from "@/lib/format";
import { Receipt, Wallet } from "lucide-react";
import { TicketPreview } from "@/components/ticket-preview";
import { ChangePaymentMethodDialog } from "@/components/change-payment-method-dialog";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/ventas")({
  head: () => ({ meta: [{ title: "Ventas · Goloso POS" }] }),
  component: VentasPage,
});

function VentasPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [changePay, setChangePay] = useState<{ id: string; ticket_number: number; total: number; payment_method: string } | null>(null);
  const qc = useQueryClient();
  const { isAdmin } = useAuth();

  const { data: sales = [] } = useQuery({
    queryKey: ["sales"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("id,ticket_number,total,payment_method,user_name,customer_name,created_at,payment_transaction_last4")
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });


  const { data: detail } = useQuery({
    queryKey: ["sale-detail", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data: s } = await supabase.from("sales").select("*").eq("id", selected!).single();
      const { data: items } = await supabase.from("sale_items").select("product_name,qty,unit_price").eq("sale_id", selected!);
      return { sale: s, items: items ?? [] };
    },
  });

  const total = sales.reduce((s, x) => s + Number(x.total), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl">Ventas</h1>
          <p className="text-muted-foreground">Historial reciente · {sales.length} tickets · {formatMoney(total)}</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cajero</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono">#{s.ticket_number}</TableCell>
                  <TableCell>{formatDate(s.created_at)}</TableCell>
                  <TableCell>{s.user_name ?? "—"}</TableCell>
                  <TableCell>{s.customer_name ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{s.payment_method}</span>
                      {s.payment_transaction_last4 && (
                        <span className="text-[11px] font-mono text-muted-foreground">
                          Trx **** {s.payment_transaction_last4}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(s.total)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setChangePay({
                            id: s.id,
                            ticket_number: s.ticket_number,
                            total: Number(s.total),
                            payment_method: s.payment_method,
                          })}
                        >
                          <Wallet className="h-4 w-4 mr-1" /> Cambiar pago
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setSelected(s.id)}>
                        <Receipt className="h-4 w-4 mr-1" /> Ver
                      </Button>
                    </div>
                  </TableCell>

                </TableRow>
              ))}
              {sales.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Sin ventas aún.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Ticket</DialogTitle></DialogHeader>
          {detail?.sale && (() => {
            const pd = (detail.sale as { payment_details?: { splits?: Array<{ method: string; amount: number; transaction_last4?: string }> } | null }).payment_details;
            const splits = pd && Array.isArray(pd.splits) ? pd.splits : null;
            return (
              <TicketPreview sale={{
                id: detail.sale.id,
                ticket_number: detail.sale.ticket_number,
                total: Number(detail.sale.total),
                payment_method: detail.sale.payment_method,
                customer: detail.sale.customer_name ?? "",
                user_name: detail.sale.user_name ?? "",
                created_at: detail.sale.created_at,
                lines: detail.items.map((i) => ({ name: i.product_name, qty: Number(i.qty), unit_price: Number(i.unit_price) })),
                tip: Number((detail.sale as { tip_amount?: number | null }).tip_amount ?? 0),
                payment_splits: splits,
              }} />
            );
          })()}
          <DialogFooter className="no-print flex-wrap gap-2">
            {isAdmin && detail?.sale && (
              <Button
                variant="secondary"
                onClick={() => setChangePay({
                  id: detail.sale!.id,
                  ticket_number: detail.sale!.ticket_number,
                  total: Number(detail.sale!.total),
                  payment_method: detail.sale!.payment_method,
                })}
              >
                <Wallet className="h-4 w-4 mr-1" /> Cambiar medio de pago
              </Button>
            )}
            <Button variant="outline" onClick={() => setSelected(null)}>Cerrar</Button>
            <Button onClick={() => window.print()}>Imprimir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangePaymentMethodDialog
        open={!!changePay}
        onOpenChange={(o) => !o && setChangePay(null)}
        sale={changePay}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["sales"] });
          qc.invalidateQueries({ queryKey: ["sale-detail"] });
        }}
      />
    </div>
  );
}
