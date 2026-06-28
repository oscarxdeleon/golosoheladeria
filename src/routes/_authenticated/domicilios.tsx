import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/_authenticated/domicilios")({
  head: () => ({ meta: [{ title: "Domicilios · Goloso POS" }] }),
  component: () => (
    <div className="space-y-4">
      <h1 className="font-display text-3xl">Domicilios</h1>
      <Card><CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
        <Construction className="h-10 w-10 text-primary" />
        <p>Gestión de pedidos a domicilio próximamente. Configura la tarifa en Ajustes → Domicilio.</p>
      </CardContent></Card>
    </div>
  ),
});
