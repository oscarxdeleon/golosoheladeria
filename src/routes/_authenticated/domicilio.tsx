import { createFileRoute } from "@tanstack/react-router";
import { PosScreen } from "@/components/pos-screen";

export const Route = createFileRoute("/_authenticated/domicilio")({
  head: () => ({ meta: [{ title: "A domicilio · Goloso POS" }] }),
  component: () => <PosScreen orderType="domicilio" />,
});
