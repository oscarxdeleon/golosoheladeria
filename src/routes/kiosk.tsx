import { createFileRoute } from "@tanstack/react-router";
import { PublicOrder } from "@/components/public-order";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { useEffect, useState } from "react";

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
  const [resolved, setResolved] = useState<string | undefined>(sede);
  useEffect(() => {
    if (sede) {
      try { localStorage.setItem("public:sede", sede); } catch {}
      setResolved(sede);
    } else {
      try {
        const stored = localStorage.getItem("public:sede");
        if (stored) setResolved(stored);
      } catch {}
    }
  }, [sede]);
  return <PublicOrder source="kiosk" branchSlug={resolved} />;
}
