import { createFileRoute } from "@tanstack/react-router";
import { PosScreen } from "@/components/pos-screen";

export const Route = createFileRoute("/_authenticated/kiosko")({
  head: () => ({ meta: [{ title: "Kiosko · Goloso POS" }] }),
  component: () => <PosScreen orderType="kiosko" />,
});
