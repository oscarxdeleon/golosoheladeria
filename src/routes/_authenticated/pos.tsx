import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PosScreen, type OrderType } from "@/components/pos-screen";

const searchSchema = z.object({
  type: z.enum(["mesa", "llevar", "domicilio", "kiosko"]).optional(),
  tableId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({ meta: [{ title: "Punto de venta · Goloso POS" }] }),
  validateSearch: searchSchema,
  component: POSRoute,
});

function POSRoute() {
  const { type, tableId } = Route.useSearch();
  const orderType: OrderType = type ?? (tableId ? "mesa" : "llevar");
  return <PosScreen orderType={orderType} tableId={tableId ?? null} />;
}
