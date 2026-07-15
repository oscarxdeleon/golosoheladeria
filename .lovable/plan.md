
# Rework del módulo Usuario Supervisor

## Objetivo

Eliminar la implementación actual del Supervisor y construir una nueva, en modo **solo lectura**, con **coincidencia exacta 1:1** con los datos del Administrador, para las sedes GOLOSO SANTA y GOLOSO PARQUE.

## Principio arquitectónico (crítico)

**Una única fuente de verdad.** El Supervisor NO tendrá RPCs propios de cálculo. Reutilizará exactamente la misma lógica de agregación que hoy usa el Administrador (`src/lib/reports.ts` → `computeFinancialSummary`, `fetchSales`, `fetchExpenses`, `fetchDeposits`, `fetchPurchases`, más las consultas del `dashboard.tsx` y `reportes.cajas_.$id.tsx`).

Los RPCs actuales `supervisor_dashboard_rpc` y `supervisor_session_detail_rpc` se eliminan. En su lugar:

- Un único RPC ligero `supervisor_validate_session_rpc(_session_token)` que verifica sesión activa y devuelve `{ supervisor_id, display_name, branches[] }`. Nada más.
- Todos los datos se leen directamente vía Supabase con las MISMAS funciones que el Admin, pero llamadas desde una capa `readonly` en el cliente Supervisor.

Para permitir esto sin dar sesión de `auth.users` al Supervisor, se añade un RPC pasarela `supervisor_read_rpc(_session_token, _kind, _params jsonb)` que:
1. Valida el token supervisor.
2. Ejecuta internamente las MISMAS queries que corren para el Admin (SECURITY DEFINER), reutilizando funciones SQL compartidas.
3. Devuelve el JSON tal cual.

Esto garantiza literalmente los mismos números.

## Cambios

### 1. Base de datos (migración)

- Mantener tablas: `supervisor_accounts`, `supervisor_sessions`, `supervisor_audit_log`.
- Simplificar `supervisor_accounts`: quitar `username`, `access_token`. Login solo por `display_name` + `pin_hash`.
- Nuevos RPCs:
  - `supervisor_login_rpc(_display_name, _pin, _user_agent, _ip)` → devuelve `session_token`, registra auditoría con IP/dispositivo/sede.
  - `supervisor_logout_rpc(_session_token)`.
  - `supervisor_validate_session_rpc(_session_token)` → devuelve supervisor + branches.
  - `supervisor_dashboard_data_rpc(_session_token, _branch_id, _date)` → **internamente llama a las MISMAS funciones/queries del dashboard admin**, envuelto en SECURITY DEFINER. Devuelve exactamente el mismo shape que consume hoy `dashboard.tsx`.
  - `supervisor_cash_session_list_rpc(_session_token, _branch_id, _date)` → lista de cierres con misma lógica que `reportes.cajas.tsx`.
  - `supervisor_cash_session_detail_rpc(_session_token, _cash_session_id)` → mismo shape que `reportes.cajas_.$id.tsx`.
- Admin CRUD: `create_supervisor_account_rpc(_display_name, _pin)`, `update_supervisor_account_rpc`, `delete_supervisor_account_rpc`, `list_supervisor_accounts_rpc`.
- Refactorizar la lógica de cálculo del Dashboard Admin actual a funciones SQL compartidas (`_admin_dashboard_payload`, `_admin_cash_session_detail`) que ambos usuarios (admin vía RLS normal, supervisor vía SECURITY DEFINER) consumen.

### 2. Frontend

Eliminar:
- `src/routes/supervisor.tsx` (versión actual pesada con lógica propia).
- Referencias en `src/lib/supervisor-client.ts` y `src/lib/supervisor.functions.ts` a los RPCs viejos.

Crear:
- `src/routes/supervisor.tsx` — login (nombre + PIN 4 dígitos).
- `src/routes/supervisor/_layout.tsx` (o wrapper) con selector de sede + tabs Dashboard / Cierre de Caja.
- `src/routes/supervisor/dashboard.tsx` — **importa y renderiza los mismos componentes visuales** del dashboard admin en modo `readOnly`. Datos vienen de `supervisor_dashboard_data_rpc`.
- `src/routes/supervisor/cierres.tsx` — vista Hoy / Ayer / Buscar fecha, lista + detalle. Reutiliza los mismos componentes de `reportes.cajas.tsx` y `reportes.cajas_.$id.tsx` en modo readOnly.
- `src/lib/supervisor-client.ts` reescrito: solo login, logout, validate, y wrappers que llaman a los 3 RPCs de lectura.
- Realtime: suscripción a `sales`, `sale_items`, `expenses`, `cash_deposits`, `cash_sessions`, `purchases` filtrando por `branch_id`; al recibir evento → `queryClient.invalidateQueries` de las claves del dashboard/cierre.
- Al cambiar sede o fecha → `queryClient.removeQueries` (no solo invalidate) para limpiar completamente.

### 3. Componentes reutilizables (extracción)

Extraer del Admin actual sin cambiar su comportamiento:
- `<DashboardKpis />`, `<PaymentBreakdown />`, `<TopProducts />`, `<CashStatusCard />` desde `_authenticated/dashboard.tsx`.
- `<CashSessionSummary />`, `<CashSessionProducts />`, `<CashSessionAdjustments />` desde `reportes.cajas_.$id.tsx`.
- `<CashSessionList />` desde `reportes.cajas.tsx`.

Cada uno acepta `data` como prop; Admin y Supervisor los alimentan con la misma estructura → imposible que diverjan.

### 4. Administración de supervisores

Sección en `/ajustes` (o `/usuarios`) para admin: crear / editar / activar / desactivar / eliminar / cambiar PIN. Sin `username` ni token visible.

### 5. Auditoría

`supervisor_audit_log` registra en cada login/switch de sede: `supervisor_id`, `event`, `ip`, `user_agent`, `branch_id`, `created_at`. Panel de consulta en admin.

### 6. Validación final

Script de comparación (en dev) que consulta ambos endpoints para SANTA y PARQUE (hoy y ayer) y hace `deepEqual` de los campos clave. Se corre con Playwright tras el deploy.

## Detalles técnicos

- Sesiones supervisor expiran a 12h; se refrescan en cada request.
- PIN se almacena con `crypt(_pin, gen_salt('bf'))`. Login usa `crypt(_pin, pin_hash) = pin_hash`.
- Rate limit: 5 intentos fallidos por nombre / 15 min → `locked_until`.
- Realtime usa el canal `supabase.channel('supervisor:'+branchId)` con filtros por `branch_id`.
- Diseño responsive con Tailwind: grid 1 col mobile / 2 col tablet / 4 col desktop en KPIs; sin truncar valores monetarios (usar `tabular-nums` y `whitespace-nowrap`).
- Rutas Supervisor son SSR-off y públicas (no bajo `_authenticated/`), protegidas por el token supervisor en localStorage.

## Archivos afectados

**Eliminados / reescritos**
- `src/routes/supervisor.tsx`
- `src/lib/supervisor-client.ts`
- `src/lib/supervisor.functions.ts`

**Nuevos**
- `src/routes/supervisor.login.tsx` (o `supervisor.index.tsx` con login)
- `src/routes/supervisor.dashboard.tsx`
- `src/routes/supervisor.cierres.tsx`
- `src/routes/supervisor.cierres.$id.tsx`
- `src/components/supervisor/*` (layout, branch selector, quick date tabs)
- `src/components/dashboard/*` (extraídos del admin)
- `src/components/cash-session/*` (extraídos del admin)
- `src/lib/supervisor-realtime.ts`
- Migración SQL grande con nuevos RPCs y funciones compartidas.

**Modificados**
- `src/routes/_authenticated/dashboard.tsx` → pasa a usar los mismos componentes extraídos.
- `src/routes/_authenticated/reportes.cajas.tsx` y `reportes.cajas_.$id.tsx` → idem.
- `src/components/supervisor-access-section.tsx` → nuevo flujo (sin token visible, sin username).

## Riesgos

- Refactor amplio del Admin para extraer componentes. Mitigación: mantener el comportamiento visual idéntico, cambiar solo la fuente del `data` prop.
- Los RPCs SECURITY DEFINER deben validar el token supervisor en la PRIMERA línea, y respetar `branch_id` permitido.
- La migración es grande; la corro en un solo paso tras aprobación.

## Estimación

1 migración SQL grande + ~15 archivos nuevos + ~6 archivos modificados. Un solo turno de implementación tras aprobación del plan.
