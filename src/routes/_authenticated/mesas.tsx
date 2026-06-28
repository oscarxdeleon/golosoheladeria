import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mesas")({
  head: () => ({ meta: [{ title: "Mesas · Goloso POS" }] }),
  component: () => <Placeholder title="Mesas" desc="Próximamente: gestión de mesas y comandas." />,
});

function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl">{title}</h1>
      <Card><CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
        <Construction className="h-10 w-10 text-primary" />
        <p>{desc}</p>
      </CardContent></Card>
    </div>
  );
}
