import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PublicOrder } from "@/components/public-order";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";

const search = z.object({
  sala: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/s/$slug/t/$tableNumber")({
  validateSearch: zodValidator(search),
  head: ({ params }) => ({ meta: [{ title: `Mesa ${params.tableNumber} · ${params.slug} · Goloso` }] }),
  component: SedeTable,
});

function SedeTable() {
  const { slug, tableNumber } = useParams({ from: "/s/$slug/t/$tableNumber" });
  const { sala } = Route.useSearch();

  const { data: table, isLoading } = useQuery({
    queryKey: ["public-table", slug, tableNumber],
    queryFn: async () => {
      const n = Number(tableNumber);
      if (!n) return null;
      const { data: b } = await supabase.from("branches").select("id").eq("slug", slug).maybeSingle();
      if (!b?.id) return null;
      const { data } = await supabase
        .from("restaurant_tables")
        .select("id,number,label,room_id,branch_id")
        .eq("number", n)
        .eq("active", true)
        .eq("branch_id", b.id)
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
      branchSlug={slug}
    />
  );
}
