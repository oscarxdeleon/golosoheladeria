import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PublicOrder } from "@/components/public-order";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";

const tableSearchSchema = z.object({
  sede: fallback(z.string().optional(), undefined),
  sala: fallback(z.string().optional(), undefined),
  mesa: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/t/$tableNumber")({
  validateSearch: zodValidator(tableSearchSchema),
  head: ({ params }) => ({ meta: [{ title: `Mesa ${params.tableNumber} · Goloso` }] }),
  component: TableOrderPage,
});

function TableOrderPage() {
  const { tableNumber } = Route.useParams();
  const { sala } = Route.useSearch();

  const { data: table, isLoading } = useQuery({
    queryKey: ["public-table", tableNumber],
    queryFn: async () => {
      const n = Number(tableNumber);
      if (!n) return null;
      const { data } = await supabase
        .from("restaurant_tables")
        .select("id,number,label,room_id")
        .eq("number", n)
        .eq("active", true)
        .maybeSingle();
      return data;
    },
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Cargando…</div>;
  if (!table)
    return (
      <div className="p-8 text-center">
        <h1 className="font-display text-2xl">Mesa no encontrada</h1>
        <p className="text-muted-foreground mt-2">Verifica el código QR o pide ayuda a un mesero.</p>
      </div>
    );

  const baseLabel = table.label ?? `Mesa ${table.number}`;
  const roomSuffix = sala ? ` · ${sala.replace(/-/g, " ")}` : "";

  return (
    <PublicOrder
      source="table_qr"
      tableId={table.id}
      tableLabel={`${baseLabel}${roomSuffix}`}
    />
  );
}
