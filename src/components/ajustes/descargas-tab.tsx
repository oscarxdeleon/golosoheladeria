import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Monitor,
  Tablet,
  Store,
  ShieldAlert,
  ExternalLink,
  Smartphone,
  Info,
  Package,
  Chrome,
  Apple,
} from "lucide-react";
import { toast } from "sonner";
import { PwaInstallButton } from "@/components/pwa-install-button";
import printServerPkg from "../../../print-server/package.json";
import appPkg from "../../../package.json";

const PRINT_SERVER_VERSION = (printServerPkg as { version: string }).version;
const APP_VERSION = (appPkg as { version?: string }).version ?? "1.0.0";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

type Target = {
  id: string;
  name: string;
  short: string;
  desc: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  audience: string;
};

const TARGETS: Target[] = [
  {
    id: "pos",
    name: "POS Principal",
    short: "Cajero / Administrador",
    desc: "Sistema completo: caja, ventas, historial, reportes y menú.",
    url: "/",
    icon: Store,
    accent: "from-sky-500 to-indigo-600",
    audience: "Windows / macOS / Linux",
  },
  {
    id: "mesero",
    name: "App Meseros",
    short: "Tablets Android",
    desc: "Mesas, comandas, cambio/unión de mesas y sincronización con caja.",
    url: "/mesas",
    icon: Tablet,
    accent: "from-emerald-500 to-teal-600",
    audience: "Android 10+ / iPad",
  },
  {
    id: "quiosco",
    name: "App Autopedido",
    short: "Quiosco de clientes",
    desc: "Catálogo, carrito, personalización y confirmación en modo fullscreen.",
    url: "/kiosk",
    icon: Package,
    accent: "from-fuchsia-500 to-purple-600",
    audience: "Tablet táctil / TV táctil",
  },
];

function copyLink(url: string) {
  const full = `${window.location.origin}${url}`;
  void navigator.clipboard.writeText(full).then(
    () => toast.success("Enlace copiado", { description: full }),
    () => toast.error("No se pudo copiar el enlace"),
  );
}

export function DescargasTab() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <Card className="premium-card border-primary/30 bg-gradient-to-br from-primary/5 via-transparent to-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-2xl font-display">
            <Download className="h-6 w-6 text-primary" />
            Descargas e Instaladores
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Centro de distribución del <b>Sistema POS Heladería Goloso</b>. Instala el sistema como
            aplicación en Windows, Android o iOS y descarga los complementos oficiales.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge variant="outline" className="gap-1">
              <Info className="h-3 w-3" /> Versión app: v{APP_VERSION}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Info className="h-3 w-3" /> Compilación: {BUILD_DATE}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Info className="h-3 w-3" /> Print Server: v{PRINT_SERVER_VERSION}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Instaladores PWA por perfil */}
      <div>
        <h3 className="text-lg font-display mb-3 flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-primary" />
          Instalar como Aplicación (PWA)
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Cada perfil abre directo en su módulo con ícono propio. Instala desde el navegador del
          dispositivo destino (Chrome, Edge o Safari).
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TARGETS.map((t) => {
            const Icon = t.icon;
            const fullUrl = `${origin}${t.url}`;
            return (
              <Card key={t.id} className="premium-card overflow-hidden">
                <div className={`h-1.5 bg-gradient-to-r ${t.accent}`} />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`h-11 w-11 shrink-0 rounded-xl bg-gradient-to-br ${t.accent} flex items-center justify-center shadow-lg`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{t.audience}</Badge>
                  </div>
                  <CardTitle className="text-base mt-2">{t.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">{t.short}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground min-h-[36px]">{t.desc}</p>
                  <div className="rounded-lg bg-muted/50 px-2 py-1.5 text-[11px] font-mono break-all">
                    {fullUrl || t.url}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="default" className="gap-1 flex-1">
                      <a href={t.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                        Abrir
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => copyLink(t.url)}
                    >
                      Copiar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Botón instalar PWA en el navegador actual */}
        <Card className="premium-card mt-4 border-dashed">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-4 py-4">
            <div className="flex-1">
              <div className="font-semibold text-sm">Instalar en este dispositivo</div>
              <p className="text-xs text-muted-foreground">
                Si tu navegador es compatible, aparecerá un botón para instalar la app aquí mismo.
                En iPhone/iPad usa Safari → Compartir → “Añadir a pantalla de inicio”.
              </p>
            </div>
            <PwaInstallButton />
          </CardContent>
        </Card>
      </div>

      {/* Instrucciones por plataforma */}
      <div>
        <h3 className="text-lg font-display mb-3 flex items-center gap-2">
          <Info className="h-5 w-5 text-primary" />
          Instrucciones por plataforma
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="premium-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Monitor className="h-4 w-4" /> Windows 10 / 11
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <ol className="list-decimal pl-4 space-y-1">
                <li>Abre el enlace en <b>Edge</b> o <b>Chrome</b>.</li>
                <li>Barra de dirección → ícono <b>Instalar</b> (💻).</li>
                <li>Confirma. Se creará el acceso directo en Escritorio y Menú Inicio.</li>
              </ol>
              <p className="pt-1">Compatible con impresoras térmicas y Print Server local.</p>
            </CardContent>
          </Card>

          <Card className="premium-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Chrome className="h-4 w-4" /> Android 10+
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <ol className="list-decimal pl-4 space-y-1">
                <li>Abre el enlace en <b>Chrome</b>.</li>
                <li>Menú <b>⋮</b> → “Instalar app” / “Añadir a pantalla principal”.</li>
                <li>Para Quiosco: activa <b>Anclar pantalla</b> (Ajustes → Seguridad).</li>
              </ol>
            </CardContent>
          </Card>

          <Card className="premium-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Apple className="h-4 w-4" /> iPhone / iPad
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <ol className="list-decimal pl-4 space-y-1">
                <li>Abre el enlace en <b>Safari</b>.</li>
                <li>Botón <b>Compartir</b> → “Añadir a pantalla de inicio”.</li>
                <li>Confirma con <b>Añadir</b>.</li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Print Server */}
      <div>
        <h3 className="text-lg font-display mb-3 flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          Complementos oficiales
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="premium-card">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base">Print Server</CardTitle>
                <Badge className="bg-emerald-600">Versión actual</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Servicio local para imprimir tickets y comandas en impresoras térmicas y abrir cajón
                monedero sin diálogo del navegador. Windows y Linux.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>📄 Nombre: <b>print-server.zip</b></li>
                <li>🏷️ Versión: <b>v{PRINT_SERVER_VERSION}</b></li>
                <li>📦 Tamaño: ~20 KB</li>
                <li>📅 Compilación: {BUILD_DATE}</li>
              </ul>
              <Button asChild className="gap-2 w-full">
                <a
                  href={`/downloads/print-server.zip?v=${PRINT_SERVER_VERSION}`}
                  download={`print-server-v${PRINT_SERVER_VERSION}.zip`}
                >
                  <Download className="h-4 w-4" />
                  Descargar Print Server
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card className="premium-card">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base">Instalador de Escritorio (Tauri)</CardTitle>
                <Badge variant="outline">Compilación externa</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Wrapper nativo para generar <b>.exe (Windows)</b>, <b>.dmg (macOS)</b> y{" "}
                <b>.AppImage/.deb (Linux)</b>. El código está en la carpeta <code>desktop/</code>{" "}
                del repositorio y se compila con GitHub Actions o localmente con Rust + Node.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>🦀 Framework: <b>Tauri 2</b></li>
                <li>🖨️ Impresión térmica: vía Print Server local</li>
                <li>🔄 Auto-updater: preparado (endpoint configurable)</li>
                <li>📖 Guía: <code>desktop/README.md</code></li>
              </ul>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button asChild variant="outline" className="gap-2 flex-1" size="sm">
                  <a href="/downloads/README.md" target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" /> Ver guía de compilación
                  </a>
                </Button>
              </div>
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200 flex gap-2">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Los binarios firmados (.exe/.dmg/.AppImage) se publican como <i>Releases</i>{" "}
                  cuando compilas desde <code>desktop/</code>. Sube el archivo generado a{" "}
                  <code>public/downloads/</code> para que aparezca aquí como descarga directa.
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modo Quiosco */}
      <Card className="premium-card border-fuchsia-500/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-5 w-5 text-fuchsia-600" /> Modo Quiosco
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            La ruta <code>/kiosk</code> incluye modo quiosco reforzado: pantalla completa
            automática, bloqueo del menú contextual, atajos y prevención de suspensión de pantalla.
          </p>
          <p className="text-xs">
            Para bloqueo total del dispositivo usa <b>Anclar pantalla</b> (Android) o inicia Chrome
            con <code>--kiosk https://tu-dominio/kiosk</code> (Windows / Linux).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
