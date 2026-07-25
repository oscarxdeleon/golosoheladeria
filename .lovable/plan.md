## Objetivo
Bloquear al **Cajero** de liberar, mover, fusionar o cancelar mesas/pedidos. Solo **Admin/Supervisor** podrán hacerlo. Añadir un **Panel de Pedidos Activos en Tiempo Real** en el módulo Admin con capacidad de cancelar/liberar con auditoría.

---

## 1. Backend (SQL) — validación de rol

Nueva migración que refuerza roles en las RPC existentes:

- `release_table(_table_id, _reason)`: exigir `has_role(uid,'admin') OR has_role(uid,'supervisor')`. Si no, `RAISE EXCEPTION 'ROLE_FORBIDDEN: Esta acción requiere autorización...'`.
- `move_table(...)`: misma validación.
- `merge_tables(...)`: misma validación.
- `cancel_sale(...)`: ya restringido — mejorar el mensaje de error para incluir el texto estándar.
- Nuevo RPC `admin_delete_sale(_sale_id, _reason)` (SECURITY DEFINER):
  - Solo admin/supervisor.
  - Marca `status='cancelled'`, revierte inventario, libera mesa si aplica, escribe en `audit_log` con `action='delete_sale'`, guarda rol.
- Todas las acciones ya escriben en `audit_log` y/o `table_events`; verificar que incluyan `cancelled_by_role`.

## 2. Frontend — bloqueo en UI

**Archivo `src/routes/_authenticated/mesas.tsx`**
- Leer rol desde `useAuth()` (ya existe helper `hasRole`).
- Deshabilitar/ocultar botones "Liberar", "Mover", "Fusionar", "Cancelar pedido" cuando el usuario no es admin ni supervisor.
- Si intentan la acción por otra vía → `toast.error("Esta acción requiere autorización. Comunícate con un Administrador o Supervisor...")`.

**Archivo `src/lib/sales-cancellation.ts`**
- Traducir el mensaje de error de PostgREST al texto estándar cuando venga `ROLE_FORBIDDEN`.

## 3. Panel de Pedidos Activos en Tiempo Real

**Nuevo archivo `src/routes/_authenticated/pedidos-activos.tsx`** (ruta `/pedidos-activos`)
- Gate: solo visible/accesible para admin y supervisor (redirige con toast si otro rol entra).
- Query con `useQuery` a `sales` filtrando `status IN ('pending','confirmed','ready')` de la sede actual (o todas si admin y sin sede seleccionada).
- Suscripción realtime a `sales` y `sale_items` (patrón `use-realtime-branch-sync` ya existe).
- Tabs / secciones por `order_type`:
  - 🍽️ Mesa · 🛍️ Para llevar · 🛵 Domicilio · 🌐 En línea · 🤖 Autopedidos (kiosco)
- Cada card muestra: `#ticket`, tipo, estado, `created_at`, cliente, mesa, total, `user_name`, sede.
- Acciones (solo admin/supervisor):
  - **Cancelar** → dialog con motivo obligatorio (min 3 chars) + confirmación "¿Está seguro…" → llama `cancel_sale`.
  - **Eliminar** → dialog con motivo + confirmación → llama nuevo RPC `admin_delete_sale`.
  - **Liberar mesa** (si `table_id` existe) → dialog con motivo → llama `release_table`.

**Añadir enlace en el sidebar del admin** (`src/components/app-sidebar.tsx` o similar) — enlace "Pedidos activos" visible solo para admin/supervisor.

## 4. Auditoría

Todas las RPC anteriores ya insertan en `audit_log` con `user_id`, `user_name`, `branch_id`, `action`, `meta`. Añadir en `meta`:
- `role` (admin/supervisor)
- `order_type`
- `reason`

## 5. Pruebas

- Iniciar sesión como cajero → verificar que en `/mesas` los botones estén deshabilitados y que la llamada directa a `release_table` devuelva error controlado.
- Iniciar sesión como admin → cancelar pedido de mesa, para llevar y domicilio → verificar en `audit_log`.
- Verificar realtime del panel: crear pedido en otra pestaña, aparece sin refrescar.

---

## Archivos afectados

- `supabase/migrations/*_role_lock_tables.sql` (nueva)
- `src/routes/_authenticated/mesas.tsx`
- `src/lib/sales-cancellation.ts`
- `src/routes/_authenticated/pedidos-activos.tsx` (nueva)
- `src/components/app-sidebar.tsx` (o el archivo del menú)

## Detalles técnicos

- Validación de rol **siempre en SQL** (SECURITY DEFINER RPC con `has_role`), UI solo es UX.
- `admin_delete_sale` marca `cancelled` en vez de `DELETE` físico para preservar historial fiscal.
- Realtime: `supabase.channel('active-orders').on('postgres_changes',{event:'*',table:'sales'},...)` con teardown en `useEffect` cleanup.
- El panel filtra por `branch_id` según `useBranch()`; admin sin sede ve todas.
