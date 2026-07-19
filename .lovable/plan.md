
# Empleados / Nómina — Descuentos, Liquidación semanal y Pagos

## 0. Viabilidad (revisado contra el sistema actual)

- El módulo `/empleados` ya existe con tabs Empleados, Horarios, Festivos y Nómina, y ya usa `attendance_employees` (con `pay_mode`, `weekly_salary`, `shift_rates`, `hours_per_shift`, `grace_minutes`, `weekly_schedule`), `company_holidays` y `attendance_late_records`. Se conserva todo.
- La asistencia ya tiene un trigger post-insert sobre `attendance_records` que llama `compute_daily_late`. Se reescribe **solo esa función interna** para aplicar la nueva escala por bloques; el trigger y la tabla `attendance_late_records` no cambian.
- Multi-sede, RLS, zona horaria (`America/Bogota`) y `has_role` ya están resueltos: se reutilizan.
- La cola de impresión (`print_jobs` + `startPrintQueueWorker`) ya funciona para comandas y ticket de venta; el comprobante de pago se despacha por el mismo canal (nada nuevo del lado del Print Server).
- Cero impacto sobre POS, cajas, WhatsApp bot ni inventario: todo va a tablas nuevas y a la ruta `/empleados`.

## 1. Cambios de base de datos (una migración)

### 1.1 Configuración de reglas (editable por admin)

`public.payroll_late_rules` — una fila por sede (o global si `branch_id IS NULL`).

- `brackets jsonb` con la escala por defecto (editable):
  ```json
  [
    {"min":5,"max":15,"deduct_minutes":30},
    {"min":30,"max":45,"deduct_minutes":60},
    {"min":60,"max":null,"deduct_minutes":120}
  ]
  ```
- `active boolean default true`.
- RLS: admin/supervisor lectura y escritura; cajero/mesero sin acceso.

### 1.2 Descuentos manuales

`public.payroll_manual_deductions`:

- `employee_id`, `amount numeric`, `concept text` (préstamo / adelanto / uniforme / daño / otro), `notes text`, `deduction_date date`, `applied_to_payment_id uuid null`, `branch_id`, `created_by`, `created_at`.
- RLS: admin/supervisor CRUD; empleado lee lo suyo.

### 1.3 Pagos (liquidaciones)

`public.payroll_payments`:

- `employee_id`, `branch_id`, `period_start date`, `period_end date`, `shifts_count int`, `gross_amount numeric`, `late_deduction numeric`, `manual_deduction numeric`, `net_amount numeric`, `payment_method text` (caja / nequi / bancolombia / otro), `paid_by uuid`, `paid_by_name text`, `paid_at timestamptz`, `notes text`, `receipt_number bigserial`.
- Único parcial por (`employee_id`, `period_start`, `period_end`) para evitar doble pago.

`public.payroll_payment_items` (snapshot inmutable del detalle):

- `payment_id`, `work_date date`, `day_type text` (weekday/weekend/holiday), `shift_rate numeric`, `late_minutes int`, `late_deduction numeric`.

RLS admin/supervisor CRUD; empleado lee lo suyo.

### 1.4 Ajuste al cálculo de tardanzas

Reescribir `public.compute_employee_late(_employee_id, _date)` para:

1. Leer `weekly_schedule` (o `festivo` si aplica) y `grace_minutes`.
2. Calcular `late_minutes` reales.
3. Buscar el bracket aplicable en `payroll_late_rules` (fallback a la escala por defecto si no hay fila).
4. `deduct_minutes = bracket.deduct_minutes` (0 si no cae en ningún bracket, incluidos `<5 min`).
5. Calcular `deduction_amount`:
   - `per_shift` → `(shift_rate_del_dia / (hours_per_shift * 60)) * deduct_minutes`.
   - `weekly_fixed` → `(weekly_salary / (dias_activos * hours_per_shift * 60)) * deduct_minutes`.
6. Upsert en `attendance_late_records` (misma tabla actual).

El trigger existente sigue apuntando a esta función → cero cambios en `attendance_records`.

### 1.5 RPCs de liquidación y pago

- `payroll_weekly_liquidation(_employee_id uuid, _week_start date)` `SECURITY DEFINER`:
  itera 7 días, calcula turnos trabajados (una entrada = un turno), suma `shift_rate` del día (weekday / weekend / holiday), suma tardanzas desde `attendance_late_records`, resta descuentos manuales pendientes (`applied_to_payment_id IS NULL`). Devuelve JSON con desglose día a día + totales. Solo lectura, sin escrituras.
- `payroll_register_payment(_employee_id, _period_start, _period_end, _payment_method, _notes)` `SECURITY DEFINER`:
  reejecuta la liquidación, inserta `payroll_payments` + `payroll_payment_items`, marca `payroll_manual_deductions.applied_to_payment_id`. Devuelve `payment_id` y `receipt_number`.
- `payroll_history(_from, _to, _employee_id?, _branch_id?)`: pagos + descuentos + tardanzas para reportes.

Cron opcional (`pg_cron` domingo 23:59) que inserta un aviso en un log — **no** paga automático (el pago siempre lo confirma el admin). Puede quedar como fase 2; para la primera entrega solo el botón "Liquidar semana" en la UI.

## 2. Frontend (`src/routes/_authenticated/empleados.tsx`)

Se añaden dos tabs y se enriquece uno existente, sin romper el resto.

### 2.1 Tab "Nómina" (reemplaza al panel actual)

- Filtro por sede + semana (default semana actual lun-dom en `America/Bogota`).
- Tabla por empleado: turnos, valor bruto, descuento por tardanza, descuento manual, neto, estado (`pendiente` / `pagado`).
- Fila expandible con detalle día a día.
- Botón por empleado **"Liquidar y pagar"** → dialog con:
  - Resumen del período (readonly).
  - Selector de método de pago (Caja, Nequi, Bancolombia, Otro).
  - Notas.
  - Confirmar → llama `payroll_register_payment` → abre ticket imprimible + envía a la cola de impresión de la sede activa (`print_jobs`).

### 2.2 Nueva tab "Descuentos manuales"

- Botón "Agregar descuento" (empleado, valor, concepto, fecha, notas).
- Listado filtrable por empleado / estado (pendiente / aplicado a pago X).
- Edición/eliminación solo mientras estén pendientes.

### 2.3 Nueva tab "Historial / Reportes"

- Sub-tabs: **Pagos**, **Descuentos**, **Tardanzas**.
- Filtros: rango de fechas, empleado, sede.
- Export CSV y reimpresión del comprobante desde la lista de pagos.

### 2.4 Perfil del empleado (dentro de tab "Empleados")

- Botón "Agregar descuento" directo en la fila.
- Botón "Ver historial" que abre modal con últimos pagos, descuentos y tardanzas.

### 2.5 Configuración de reglas

Dentro del dialog de empleado o en un mini-panel "Reglas de tardanza" en el tab "Nómina": editor visual de brackets (min, max, minutos a descontar) por sede. Persiste en `payroll_late_rules`.

## 3. Comprobante de pago

Componente `PayrollReceipt` estilo `TicketPreview`:

- Logo + "HELADERÍA GOLOSO".
- Sede, dirección, NIT (de `settings`).
- **Comprobante de Pago #<receipt_number>**.
- Empleado, cargo, cédula.
- Concepto: "Pago de turnos".
- Período (desde → hasta), turnos trabajados.
- Total generado, descuento por tardanza, descuentos manuales (con lista), neto pagado.
- Método de pago, usuario, fecha/hora.
- Firma / espacio para firma del empleado.

Impresión:

- Vista imprimible en pantalla (misma clase `print-area`).
- Envío a `print_jobs` con `kind='payroll_receipt'` para que el Print Server actual lo imprima en la impresora de la sede sin cambios.

## 4. Reportes

- Reporte por empleado (todos los pagos + descuentos + tardanzas).
- Reporte por sede (agregado semanal / mensual).
- Reporte por rango con export CSV y reimpresión.
- Reutiliza `payroll_history` RPC + tabla shadcn `DataTable` local.

## 5. Validaciones técnicas

- **Asistencia**: solo se cambia el cuerpo de `compute_employee_late`; el trigger y la UI del terminal no se tocan.
- **Supabase / RLS**: todas las tablas nuevas con `GRANT` + `ENABLE RLS` + policies vía `has_role`.
- **Multi-sede**: cada pago y descuento persiste `branch_id`; los filtros de UI parten del branch activo (`useBranch`).
- **Cajas**: los pagos por método "Caja" **no** tocan `cash_sessions`; se registran solo como `payroll_payments`. Si más adelante se quiere descontar de caja, se añade en fase 2 (fuera de scope para no romper cuadres actuales).
- **Concurrencia**: `payroll_register_payment` corre dentro de una transacción; unique parcial evita doble pago del mismo período.
- **Historia inmutable**: `payroll_payment_items` guarda snapshot; si el admin cambia tarifas después, los pagos anteriores no se alteran.
- **Zona horaria**: todos los cortes usan `timezone('America/Bogota', ...)`.
- **Rendimiento**: índices en `payroll_payments(employee_id, period_end)`, `payroll_manual_deductions(employee_id, applied_to_payment_id)`.

## 6. Orden de ejecución

1. Migración SQL (tablas + policies + RPCs + reescritura de `compute_employee_late`).
2. `src/lib/payroll.functions.ts` con wrappers tipados sobre las RPCs.
3. Actualizar `src/routes/_authenticated/empleados.tsx`: nuevas tabs y flujos.
4. `src/components/payroll/receipt.tsx` (comprobante) + integración con `print_jobs`.
5. Verificación: build, insertar entrada tarde de prueba, liquidar semana demo, imprimir.

Confirmame para proceder con la migración y la implementación completa.
