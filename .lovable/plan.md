# Plan: Anulación de ventas y módulo "Todos los pedidos"

## 1. Traducción de estados (en toda la app)

Centralizar traducción en `src/lib/format.ts` con helper `translateSaleStatus(status)`:

- `cancelled` → **Anulado**
- `pending` → Pendiente
- `paid` → Pagado
- `completed` → Completado
- `preparing` → En preparación
- `ready` → Listo
- `delivered` → Entregado
- `refunded` → Reembolsado

Reemplazar usos crudos (`{sale.status}`) en:
- `historial.tsx`, `ventas.tsx`, `domicilio.tsx`, `domicilios.tsx`, `pedidos-online.tsx`, `todos-pedidos.tsx`, `reportes.ventas.tsx`, `reportes.cajas_.$id.tsx`, `pos-screen.tsx` (detalle), `ticket-preview.tsx`, `print-client.ts` (tickets).

## 2. Base de datos (migración)

**Nueva tabla `sale_cancellations`** (auditoría inmutable):
- `sale_id`, `cancelled_by` (uuid), `cancelled_by_name`, `reason_code` (enum: `arrepentimiento`, `sin_dinero`, `cambio_producto`, `demora`, `cambio_pago`, `otro`), `reason_text`, `original_total`, `original_payment_method`, `original_order_type`, `cash_session_id`, `refund_movement_id` (nullable), `created_at`.
- RLS: SELECT para todos los autenticados de la sede; INSERT solo vía RPC.

**Nueva RPC `cancel_sale(_sale_id, _reason_code, _reason_text)`** — `SECURITY DEFINER`:
1. Valida rol (admin/supervisor siempre; cajero solo si `settings.cashier_can_cancel = true` y venta del turno actual).
2. Bloquea si `status = 'cancelled'`.
3. Si `status = 'paid'`: registra fila en `cash_deposits` tipo `refund` (o `expenses` categoría "Anulaciones") por cada método de pago (efectivo/nequi/bancolombia/transferencia) para revertir cuadre.
4. Marca `sales.status = 'cancelled'`, guarda `cancelled_at`, `cancelled_by`, `cancellation_reason`.
5. Inserta `sale_cancellations`.
6. Libera mesa (si `table_id`): `restaurant_tables.status = 'available'`.
7. Devuelve JSON con impacto en caja.

**Columnas nuevas en `sales`**: `cancelled_at`, `cancelled_by`, `cancellation_reason_code`, `cancellation_reason_text`.

**Setting global**: `cashier_can_cancel_sales boolean default false` en `settings`.

## 3. Módulo "Todos los pedidos" (rediseño de `todos-pedidos.tsx`)

Vista unificada con:

**Filtros por tipo** (chips clickeables): Todos · Mesa · Llevar · Domicilio · Kiosko

**Filtros por rango** (según rol):
- **Cajero**: fijo a "Turno actual" (filtro `cash_session_id = sesión abierta del usuario`). Sin selector de fechas.
- **Admin/Supervisor**: Turno actual · Hoy · Ayer · Semana pasada · Mes actual · Rango personalizado (date-range picker).

**Tabla/lista con columnas**: #Ticket · Fecha/hora · Cliente · Tipo · Método pago · Estado (traducido, badge colorizado) · Usuario · Total · Acciones.

**Acciones por fila**: Ver detalle · Reimprimir · **Anular** (si no está ya anulada y permiso ok).

**Diálogo de anulación**:
- RadioGroup con 6 motivos + textarea condicional para "Otro".
- Muestra resumen: total, método(s) de pago, aviso "Se registrará una salida de caja por $X".
- Botón confirmar llama a RPC `cancel_sale`.
- Toast con resultado; invalida queries.

## 4. Seguridad

- Cajero: solo anula ventas de **su turno abierto** y del **día actual**, y solo si setting lo permite.
- Admin/supervisor: siempre.
- No re-anulable.
- Registro completo en `sale_cancellations` + `audit_log`.

## 5. Reportes

Nueva pestaña "Anulaciones" en `reportes.tsx` (o sección en `reportes.ventas.tsx`) listando `sale_cancellations` con: ticket, valor, motivo, usuario, fecha, método, tipo, impacto caja.

## 6. Archivos afectados

**Nuevos/migración:**
- Migración SQL (tabla, columnas, RPC, setting).

**Modificados:**
- `src/lib/format.ts` — helper de traducción.
- `src/routes/_authenticated/todos-pedidos.tsx` — rediseño completo.
- `src/components/cancel-sale-dialog.tsx` — nuevo componente.
- `src/lib/sales-cancellation.ts` — wrapper de la RPC.
- `src/routes/_authenticated/historial.tsx`, `ventas.tsx`, `domicilio.tsx`, `domicilios.tsx`, `pedidos-online.tsx`, `reportes.ventas.tsx`, `reportes.cajas_.$id.tsx` — usar `translateSaleStatus`.
- `src/components/ticket-preview.tsx`, `src/lib/print-client.ts` — traducir estado en impresión.
- `src/components/ajustes/roles-tab.tsx` — toggle "Cajeros pueden anular ventas".
- `src/routes/_authenticated/reportes.tsx` (o nuevo `reportes.anulaciones.tsx`).

## Notas técnicas

- La reversión en caja se hace insertando un movimiento negativo por método de pago (usando `cash_deposits` con `kind='refund'` o creando `cash_refunds`), de modo que `close_cash_session_blind` ya lo tome en cuenta sin cambios.
- La RPC es transaccional: si falla la reversión, se hace rollback del status.
- Los tickets impresos con `status='cancelled'` mostrarán marca de agua "ANULADO".

¿Apruebas para implementar?