import { createFileRoute, Navigate, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/s/$slug/")({
  component: SedeIndex,
});

function SedeIndex() {
  const { slug } = useParams({ from: "/s/$slug/" });
  return <Navigate to="/s/$slug/menu" params={{ slug }} replace />;
}
