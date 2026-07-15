## Objetivo

Reemplazar completamente la lógica actual del módulo Supervisor por una vista **solo lectura** que reutilice los mismos servicios, consultas y componentes del Administrador. Los valores mostrados al Supervisor deben ser idénticos, bit a bit, a los del Dashboard, Reportes e Historial de Cajas del Administrador para la misma sede/fecha/turno.

## Diagnóstico actual

- `supervisor.tsx` y `supervisor-client.ts` mantienen consultas paralelas (a través del RPC `supervisor_dashboard_rpc`) con fórmulas propias que no coinciden con las del Dashboard Administrador.
- `paymentBreakdown`, cálculo de "efectivo esperado" y "Top de productos" están duplicados y desincronizados.
- El Supervisor no consume `dashboard.tsx`, `reportes.cajas.tsx`, `reportes.cajas_.$id.tsx`, ni las funciones de `reports.ts` / `cash-report.functions.ts` que usa el Administrador.
- No hay selector de fecha (hoy / ayer / personalizada), no hay historial ni detalle de cierre.

## Plan de implementación

### A. Extraer lógica compartida a un servicio central

Crear `src/lib/shift-metrics.ts` (o reutilizar/extender `src/lib/reports.ts` y `cash-report.functions.ts`) con **una sola** implementación de:

- `getShiftSummary(branchId, date | sessionId)` → ventas totales, pedidos, ticket, cancelados, tipos de servicio, top productos (solo producto principal), estado de caja, cajero, hora apertura.
- `getPaymentBreakdown(sales)` → desglose Efectivo / Nequi / Bancolombia / Otros digitales, con pagos mixtos correctamente distribuidos (sin "SPLIT/SPLITS").
- `getCashBalance(session, movements)` → apertura + ventas efectivo + entradas − gastos efectivo − salidas − retiros − devoluciones efectivo.
- `getMovements(sessionId)` → gastos, retiros, entradas, depósitos, devoluciones, reembolsos, con detalle por movimiento.
- `getRealtimeShiftState(branchId)` → mesas ocupadas, para‑llevar pendientes, domicilios pendientes, pedidos en preparación.

El Dashboard Administrador y todos los reportes deben migrarse para consumir estas mismas funciones (eliminando duplicados en `dashboard.tsx`, `reportes.*`, `caja.tsx`).

### B. Rediseñar el módulo Supervisor

Reescribir `src/routes/supervisor.tsx` como un shell con tabs, consumiendo exclusivamente el servicio central:

```
┌──────────────────────────────────────────────────────┐
│ [GOLOSO SANTA ▾]     [Hoy] [Ayer] [📅 Fecha]        │
├──────────────────────────────────────────────────────┤
│ Tabs: Dashboard │ Historial de Cajas │ Salidas      │
└──────────────────────────────────────────────────────┘
```

**Tab Dashboard** — reutiliza el mismo componente visual del Administrador (`DashboardView`), con todas las acciones deshabilitadas. Muestra por defecto el turno abierto del día. Si no hay turno abierto: aviso *"No existe un turno activo actualmente en esta sede"* + resumen del día.

**Tab Historial de Cajas** — reutiliza `reportes.cajas.tsx` en modo lectura, filtrado por la sede seleccionada. Cada fila con botón **Ver detalle** que abre la misma vista `reportes.cajas_.$id.tsx` (Resumen / Productos / Ajustes) en solo lectura.

**Tab Salidas** — nueva vista con detalle por movimiento (fecha, hora, usuario, tipo, categoría, descripción, medio, valor, estado, motivo anulación) y totales por categoría.

### C. Selector de fecha y sede

- Selector superior con chips: **Hoy** (default), **Ayer**, y un date-picker para fecha personalizada.
- Al cambiar sede o fecha: `queryClient.cancelQueries()` + `queryClient.removeQueries({ queryKey: ['supervisor'] })` y re-fetch. Query keys incluyen `branchId` y `date` para evitar mezclas.

### D. Tiempo real

Suscripción única Supabase Realtime a `sales`, `sale_items`, `cash_sessions`, `cash_deposits`, `expenses`, `restaurant_tables`, `table_events`. Cada evento dispara `queryClient.invalidateQueries({ queryKey: ['supervisor', branchId] })`. Botón *Actualizar* como respaldo.

### E. Solo lectura (frontend + backend)

- Frontend: el shell Supervisor no monta ninguna acción de escritura; los componentes reutilizados se renderizan con prop `readOnly`.
- Backend: verificar que las RLS ya bloquean escritura al rol supervisor (revisar y ajustar migración si falta).

### F. Pagos mixtos

Corregir `paymentBreakdown` en el servicio central: cuando `payment_details.split === true`, iterar `splits[]` y acumular en su método real. Nunca mostrar "SPLIT" ni "SPLITS" como método.

### G. Top de productos

En el servicio central: agrupar por `product_id` (nombre del producto principal), ignorando modificadores/toppings/observaciones.

### H. Formato

Auditar tarjetas del Supervisor: sin `truncate`, sin `text-ellipsis`, sin abreviaciones de montos. Responsive mobile/tablet/desktop.

### I. Validación

Después de implementar, comparar manualmente con Playwright: Dashboard Admin vs Supervisor para GOLOSO SANTA y GOLOSO PARQUE, turno abierto y cierre de ayer. Todos los valores deben coincidir.

## Detalles técnicos

- Archivos nuevos: `src/lib/shift-metrics.ts`, `src/lib/shift-metrics.functions.ts`, `src/components/supervisor/*` (shell, tabs, selector).
- Archivos reescritos: `src/routes/supervisor.tsx`, `src/lib/supervisor-client.ts` (eliminado o reducido a re-export), `src/lib/supervisor.functions.ts`.
- Migración SQL: eliminar/dejar en desuso `supervisor_dashboard_rpc`; añadir RLS de solo lectura para rol supervisor si no existen.
- Refactor de `dashboard.tsx`, `reportes.cajas.tsx`, `reportes.cajas_.$id.tsx`, `caja.tsx` para consumir el mismo servicio central (sin cambios visuales).

## Alcance y riesgo

Este es un refactor grande (~2000 LoC tocadas + nuevos componentes + migración SQL). Requiere que el Administrador y todos los reportes migren al servicio central en el mismo cambio para garantizar "una única fuente de verdad". Existe riesgo de regresiones visuales menores en el Dashboard Administrador que se validarán con Playwright.

¿Apruebas este rediseño completo, o prefieres que lo divida en fases (primero servicio central + Dashboard Supervisor, luego Historial + Salidas, luego migración del Administrador)?
