import { createFileRoute } from "@tanstack/react-router";
import { PublicOrder } from "@/components/public-order";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";

const menuSearch = z.object({
  sede: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/menu")({
  validateSearch: zodValidator(menuSearch),
  head: () => ({ meta: [{ title: "Menú en línea · Goloso" }] }),
  component: MenuPage,
});

function MenuPage() {
  const { sede } = Route.useSearch();
  return <PublicOrder source="online_menu" branchSlug={sede} />;
}
