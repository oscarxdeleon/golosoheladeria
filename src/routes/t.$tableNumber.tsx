import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PublicOrder } from "@/components/public-order";

export const Route = createFileRoute("/t/$tableNumber")({
  head: ({ params }) => ({ meta: [{ title: `Mesa ${params.tableNumber} · Goloso` }] }),
  component: TableOrderPage,
});

function TableOrderPage() {
  const { tableNumber } = Route.useParams();
  const { data: table, isLoading } = useQuery({
    queryKey: ["public-table", tableNumber],
    queryFn: async () => {
      const n = Number(tableNumber);
      if (!n) return null;
      const { data } = await supabase
        .from("restaurant_tables")
        .select("id,number,label")
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

  return <PublicOrder source="table_qr" tableId={table.id} tableLabel={table.label ?? `Mesa ${table.number}`} />;
}
