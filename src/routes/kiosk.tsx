import { createFileRoute } from "@tanstack/react-router";
import { PublicOrder } from "@/components/public-order";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";

const kioskSearch = z.object({
  sede: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/kiosk")({
  validateSearch: zodValidator(kioskSearch),
  head: () => ({ meta: [{ title: "Auto-pedido · Goloso" }] }),
  component: KioskPage,
});

function KioskPage() {
  const { sede } = Route.useSearch();
  return <PublicOrder source="kiosk" branchSlug={sede} />;
}
