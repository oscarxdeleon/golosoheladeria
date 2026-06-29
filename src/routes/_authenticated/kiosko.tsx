import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Monitor, Copy, ExternalLink, Download, Smartphone, Banknote } from "lucide-react";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/kiosko")({
  head: () => ({ meta: [{ title: "Kiosko · Goloso POS" }] }),
  component: KioskoAdmin,
});

function KioskoAdmin() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = `${origin}/kiosk`;
  const [copied, setCopied] = useState(false);

  const { data: orders = [] } = useQuery({
    queryKey: ["kiosk-orders"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("*, sale_items(qty,product_name)")
        .eq("source", "kiosk")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
    refetchInterval: 5000,
  });

  function copy() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Link copiado");
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadQR() {
    const canvas = document.querySelector<HTMLCanvasElement>("#kiosk-qr canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "kiosko-goloso-qr.png";
    a.click();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl flex items-center gap-2">
          <Monitor className="h-7 w-7" /> Kiosko de auto-pedido
        </h1>
        <p className="text-sm text-muted-foreground">
          Configura una tablet fija en el local apuntando al siguiente link. Los pedidos llegan acá y al KDS.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Link del kiosko</CardTitle>
            <CardDescription>Abre este link en el navegador de la tablet, ponlo en modo pantalla completa.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copy}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => window.open(link, "_blank")}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
            {copied && <p className="text-xs text-success">¡Copiado!</p>}
            <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
              <p className="font-medium">Pasos rápidos:</p>
              <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
                <li>Abre {link} en la tablet</li>
                <li>Activa "Agregar a pantalla de inicio" o modo Kiosko del navegador</li>
                <li>Los pedidos enviados aparecerán aquí y en el KDS</li>
              </ol>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>QR para imprimir</CardTitle>
            <CardDescription>Útil para invitar al cliente a escanear desde su propio teléfono.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <div id="kiosk-qr" className="rounded-xl border bg-white p-4">
              <QRCodeCanvas value={link} size={180} level="M" />
            </div>
            <Button variant="outline" size="sm" onClick={downloadQR}>
              <Download className="h-4 w-4" /> Descargar PNG
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pedidos recientes del kiosko</CardTitle>
          <CardDescription>Solo se muestran pedidos generados desde la tablet del kiosko.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {orders.map((o: { id: string; ticket_number: number; created_at: string; status: string; total: number; customer_name: string | null; sale_items: { qty: number; product_name: string }[] }) => (
              <div key={o.id} className="p-4 flex items-start gap-3">
                <div className="font-display text-2xl text-primary w-16 shrink-0">#{o.ticket_number}</div>
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">{formatDate(o.created_at)}</div>
                  {o.customer_name && <div className="text-sm font-medium">{o.customer_name}</div>}
                  <div className="text-sm text-muted-foreground mt-1">
                    {o.sale_items.map((i) => `${i.qty}× ${i.product_name}`).join(" · ")}
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant={o.status === "pending" ? "default" : o.status === "paid" ? "secondary" : "outline"}>
                    {o.status === "pending" ? "Pendiente" : o.status === "paid" ? "Cobrado" : "Cancelado"}
                  </Badge>
                  <div className="font-medium mt-1">{formatMoney(o.total)}</div>
                </div>
              </div>
            ))}
            {orders.length === 0 && (
              <div className="p-12 text-center text-muted-foreground">
                Aún no hay pedidos del kiosko. Comparte el link con la tablet.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
