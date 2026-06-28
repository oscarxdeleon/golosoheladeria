import { createFileRoute } from "@tanstack/react-router";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Phone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ayuda")({
  head: () => ({ meta: [{ title: "Ayuda · Goloso POS" }] }),
  component: AyudaPage,
});

const faqs = [
  { q: "¿Cómo registro una venta?", a: "Ve a Caja, toca los productos que el cliente pide y pulsa el método de pago. Se genera un ticket imprimible." },
  { q: "¿Cómo agrego un nuevo sabor o producto?", a: "Menú → Productos → Nuevo. Solo administradores pueden agregar o editar." },
  { q: "¿Cómo creo más empleados?", a: "Cada empleado se registra desde la pantalla de ingreso, pestaña Crear cuenta. Por defecto entra como Cajero." },
  { q: "¿Quién puede modificar el catálogo y ajustes?", a: "Solo usuarios con rol Administrador. El primer registro queda como admin." },
  { q: "¿Cómo configuro mi impresora?", a: "Ajustes → Impresoras. Agrega la IP, puerto, plataforma y área (caja/cocina/barra)." },
  { q: "¿Dónde veo el reporte del día?", a: "Dashboard muestra ventas, tickets, ticket promedio y top de productos. Más detalle en Ventas." },
];

function AyudaPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-3xl">Ayuda</h1>
        <p className="text-muted-foreground">Preguntas frecuentes y contacto.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>FAQ</CardTitle></CardHeader>
        <CardContent>
          <Accordion type="single" collapsible>
            {faqs.map((f, i) => (
              <AccordionItem key={i} value={`q${i}`}>
                <AccordionTrigger>{f.q}</AccordionTrigger>
                <AccordionContent>{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Contacto soporte</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /> soporte@goloso.app</div>
          <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-primary" /> +57 300 000 0000</div>
        </CardContent>
      </Card>
    </div>
  );
}
