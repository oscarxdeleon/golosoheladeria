import { createFileRoute } from "@tanstack/react-router";
import { PosScreen } from "@/components/pos-screen";

export const Route = createFileRoute("/_authenticated/llevar")({
  head: () => ({ meta: [{ title: "Para llevar · Goloso POS" }] }),
  component: () => <PosScreen orderType="llevar" />,
});
