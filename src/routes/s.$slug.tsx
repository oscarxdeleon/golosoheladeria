import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/s/$slug")({
  component: SedeLayout,
});

function SedeLayout() {
  const { slug } = useParams({ from: "/s/$slug" });
  useEffect(() => {
    if (slug) {
      try {
        localStorage.setItem("public:sede", slug);
      } catch {}
    }
  }, [slug]);
  return <Outlet />;
}
