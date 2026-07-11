# Fase 3 – Modo Offline

Un POS que "funciona sin internet" tiene tres niveles de complejidad muy distintos. Antes de escribir código, conviene fijar qué nivel implementar. Recomiendo hacerlos por etapas separadas, en este orden, y no todo en una sola tanda.

## Etapa A — Cascarón instalable + catálogo offline (bajo riesgo)

**Qué logra:** si se cae internet, la app abre, muestra el menú/productos/precios/mesas cacheados, y el cajero puede navegar. Ventas nuevas siguen requiriendo red.

**Cambios:**
- Añadir `vite-plugin-pwa` con `generateSW`, `registerType: "autoUpdate"`, `NetworkFirst` para HTML, `CacheFirst` para assets hasheados.
- Registrar el service worker desde un wrapper con las guardas obligatorias de Lovable (no registrar en preview / iframe / dev / `?sw=off`).
- Manifest + iconos para "Agregar a pantalla de inicio".
- Persistir en IndexedDB (React Query persister) las queries clave: `products`, `categories`, `modifier_groups`, `branches`, `restaurant_tables`, `role_permissions`.
- Al perder conexión: mostrar el catálogo cacheado en modo "solo lectura" (banner "Sin conexión — no puedes cobrar ni enviar comandas").
- Kill-switch listo por si algo sale mal en producción.

**Riesgo:** bajo. No toca lógica de negocio.

## Etapa B — Cola offline de ventas (riesgo alto, mucho testing)

**Qué logra:** el cajero puede cobrar en efectivo y guardar comandas sin red. Cuando vuelve la conexión, la cola sincroniza al backend.

**Retos serios:**
- **Numeración de tickets**: el `ticket_number` lo asigna el backend. Offline hay que usar un ID temporal y mostrar "Ticket local #L-42" hasta sincronizar.
- **Inventario**: descontar stock offline crea desfases. Hay que decidir: ¿bloqueamos productos con stock crítico? ¿o permitimos y reconciliamos?
- **Caja**: apertura/cierre de caja no debería hacerse offline (afecta arqueo y auditoría).
- **Conflictos**: si dos terminales venden el mismo producto offline y se sincronizan, hay que resolver duplicados y stock negativo.
- **Impresión**: la comanda a cocina no llega si el KDS depende del backend. Se imprime en la impresora local (ya funciona con print-client), pero el KDS no verá el pedido hasta la sincronización.
- **Auditoría**: cada operación offline necesita marca de tiempo del dispositivo + del servidor al sincronizar.
- **Seguridad**: las políticas RLS deben validar la venta al sincronizarla; una venta offline manipulada localmente no debe pasar validación.

**Alcance mínimo recomendado:**
- Solo ventas de **efectivo** en modo **para llevar** (evita mesas/domicilios/tarjeta).
- Requiere caja abierta ANTES de perder red.
- Sync con reintentos exponenciales y UI de "pendientes por sincronizar".
- Botón manual "reintentar sincronización" en el header.

**Riesgo:** alto. Requiere pruebas exhaustivas en cada módulo integrado.

## Etapa C — Realtime resiliente y multi-terminal (opcional)

**Qué logra:** cuando vuelve la conexión, se resuelven conflictos entre lo que ocurrió offline en Terminal A y las ventas que sí llegaron desde Terminal B.

Requiere:
- Merge de sesiones de caja
- Detección de tickets duplicados por fingerprint
- Reconstrucción de inventario post-sync

**Riesgo:** muy alto. Solo recomiendo abordarlo tras varias semanas con la Etapa B estable.

## Recomendación

Implementar **solo la Etapa A** en este turno. Es útil por sí sola (la app deja de dar pantalla en blanco cuando hay microcortes de red), no toca negocio, y sienta la base técnica (SW + persister de queries) para las etapas B/C.

La Etapa B merece su propio proyecto con tests dedicados y probablemente un piloto en una sede antes de activarla globalmente. Meterla ahora dentro del mismo prompt haría muy difícil revisar y validar los cambios.

## Detalle técnico – Etapa A

- `bun add vite-plugin-pwa workbox-window @tanstack/query-sync-storage-persister @tanstack/react-query-persist-client idb-keyval`
- `vite.config.ts`: registrar `VitePWA` con `injectRegister: null`, `devOptions.enabled: false`, `workbox.navigateFallbackDenylist: [/^\/~oauth/]`.
- `src/lib/pwa-register.ts`: wrapper con guardas Lovable (iframe, `id-preview--*`, `preview--*`, `*.lovableproject.com`, `*.lovableproject-dev.com`, `*.beta.lovable.dev`, `?sw=off`, `!import.meta.env.PROD`). Unregister en contextos rechazados.
- `public/manifest.webmanifest` + iconos 192/512 (usar el logo existente si hay).
- `src/main.tsx`: crear persister IDB para React Query y envolver `QueryClientProvider` en `PersistQueryClientProvider` con `maxAge: 24h`, `buster` según build id, y whitelist de query keys seguras.
- Nuevo hook `useOnlineStatus()` (ya existe `useConnectionStatus`, reutilizarlo) que dispare un banner global con `sonner` cuando `online === false`.
- En `pos-screen.tsx` y `caja.tsx`: si `!online`, deshabilitar botones de cobrar/imprimir comanda/abrir caja con tooltip "Requiere conexión".

## Decisión pendiente

¿Confirmas que quieres solo la Etapa A ahora, o prefieres arrancar directamente con la Etapa B (ventas offline)? La Etapa B duplica el alcance del cambio y requiere reservar tiempo para pruebas en cada módulo (caja, KDS, inventario, historial, auditoría).
