import { createFileRoute } from "@tanstack/react-router";
import { PublicOrder } from "@/components/public-order";

export const Route = createFileRoute("/menu")({
  head: () => ({ meta: [{ title: "Menú en línea · Goloso" }] }),
  component: () => <PublicOrder source="online_menu" />,
});
