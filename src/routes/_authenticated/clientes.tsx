import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({ meta: [{ title: "Clientes · Goloso POS" }] }),
  component: () => (
    <div className="space-y-4">
      <h1 className="font-display text-3xl">Clientes</h1>
      <Card><CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
        <Construction className="h-10 w-10 text-primary" />
        <p>Registro de clientes y fidelización próximamente.</p>
      </CardContent></Card>
    </div>
  ),
});
