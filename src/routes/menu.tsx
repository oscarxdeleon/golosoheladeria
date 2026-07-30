import { createFileRoute } from "@tanstack/react-router";
import { PublicOrder } from "@/components/public-order";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";

const menuSearch = z.object({
  sede: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/menu")({
  validateSearch: zodValidator(menuSearch),
  head: () => ({
    meta: [
      { title: "Heladería Goloso — Menú Digital" },
      { name: "description", content: "Explora nuestro menú en línea, helados, toppings y realiza tu pedido en la sede seleccionada." },
      { property: "og:title", content: "Heladería Goloso — Menú Digital" },
      { property: "og:description", content: "Explora nuestro menú en línea, helados, toppings y realiza tu pedido en la sede seleccionada." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://golosoheladeria.lovable.app/menu" },
      { property: "og:image", content: "https://golosoheladeria.vercel.app/og-menu.jpg?v=3" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Heladería Goloso — Menú Digital" },
      { name: "twitter:description", content: "Explora nuestro menú en línea, helados, toppings y realiza tu pedido en la sede seleccionada." },
      { name: "twitter:image", content: "https://golosoheladeria.vercel.app/og-menu.jpg?v=3" },
      { name: "apple-mobile-web-app-title", content: "Goloso" },
      { name: "application-name", content: "Goloso" },
    ],
    links: [{ rel: "manifest", href: "/manifest.webmanifest" }],
  }),
  component: MenuPage,
});

function MenuPage() {
  const { sede } = Route.useSearch();
  return <PublicOrder source="online_menu" branchSlug={sede} />;
}
