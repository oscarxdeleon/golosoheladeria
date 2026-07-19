Nuevo módulo **Empleados & Nómina** que amplía la infraestructura de asistencia ya existente (`attendance_employees`, `attendance_records`, `attendance_terminals`) sin romperla, y añade horarios detallados, cálculo de retrasos y descuentos automáticos.

## 1. Análisis de viabilidad

Reviso lo existente:
- Ya existe `attendance_employees` con: `full_name`, `document_id`, `job_position`, `phone`, `branch_id`, `schedule` (jsonb), `active`, `photo_url`, `face_descriptor`.
- Ya existe `attendance_records` con `record_type` (`entrada`, `salida`, `pausa_inicio`, `pausa_fin`) y `recorded_at`.
- Ya hay terminal facial/pin en `/asistencia/terminal/$slug` y página `_authenticated/asistencia.tsx`.
- Multi-sede resuelto por `branch_id`; RLS ya activa.
- Zona horaria: el sistema usa `America/Bogota` como fuente única (ver `src/lib/schedules.ts`).

Conclusión: **NO hay que crear un módulo paralelo**. Extiendo `attendance_employees` con configuración de horarios avanzada + pago, y sumo tablas para festivos y snapshots de retrasos. Cero impacto sobre asistencia actual: los campos nuevos son nullable con default sano.

## 2. Cambios en base de datos (una sola migración)

**Extender `attendance_employees`:**
- `weekly_schedule jsonb` — nueva forma detallada por día:
  ```json
  {
    "lun":{"works":true,"in":"14:00","out":"22:00"},
    "mar":{"works":true,"in":"14:00","out":"22:00"},
    ...
    "sab":{"works":true,"in":"13:00","out":"23:00"},
    "dom":{"works":true,"in":"13:00","out":"23:00"},
    "festivo":{"works":true,"in":"13:00","out":"23:00"}
  }
  ```
  (El campo `schedule` viejo se conserva por compatibilidad; los lectores nuevos priorizan `weekly_schedule`.)
- `pay_mode text` check in (`weekly_fixed`,`per_shift`) default `weekly_fixed`.
- `weekly_salary numeric` — para `weekly_fixed`.
- `shift_rates jsonb` — para `per_shift`: `{"weekday":30000,"weekend_holiday":50000,"per_day":{"lun":30000,...}}` (opcional).
- `hours_per_shift numeric default 8` — usado para calcular valor/hora en modo fijo semanal (semanal / (días_trabajados × horas)).
- `grace_minutes int default 0` — tolerancia antes de contar retraso.

**Nueva tabla `public.company_holidays`:**
- `date date PK`, `name text`, `branch_id uuid null` (null = todas las sedes).
- GRANT authenticated select/insert/update/delete; admin/supervisor pueden escribir.

**Nueva tabla `public.attendance_late_records`** (auditoría inmutable de retrasos):
- `employee_id`, `date date`, `scheduled_in time`, `actual_in timestamptz`, `late_minutes int`, `deduction_amount numeric`, `pay_mode`, `computed_at timestamptz`.
- UNIQUE(`employee_id`,`date`) para evitar duplicados.
- RLS: admin/supervisor lectura total; empleado ve solo los suyos (por profile_id join).

**RPC `public.payroll_period_summary(_from date, _to date, _employee_id uuid?, _branch_id uuid?)`** `SECURITY DEFINER`:
- Recorre días del período.
- Para cada empleado activo, cruza `weekly_schedule` (con festivos → clave `festivo`) contra el primer `entrada` del día en `attendance_records`.
- Calcula minutos de retraso (respetando `grace_minutes`) y descuento:
  - `weekly_fixed`: `valor_minuto = weekly_salary / (dias_semanales × hours_per_shift × 60)`.
  - `per_shift`: `valor_minuto = tarifa_dia / (hours_per_shift × 60)`.
- Devuelve por empleado: total días trabajados, minutos totales de retraso, descuento acumulado, pago bruto, pago neto, y detalle por día.
- Upserts en `attendance_late_records` para persistir historial.

**RPC `public.compute_daily_late(_date date)`** para invocarse al cierre del día o bajo demanda desde el panel.

## 3. Frontend

**Nueva ruta `/empleados` (`src/routes/_authenticated/empleados.tsx`)** con tabs:

1. **Empleados** — lista + alta/edición.
   - Dialog con: nombre, cédula, teléfono, cargo, sede, activo/inactivo, modo de pago (semanal fijo / por turno), salario, tarifas por turno, horas por turno, tolerancia.
   - Editor visual de horario por día (7 días + "Festivos") con toggle "trabaja" + horas in/out.
   - Reemplaza la vista actual de "Empleados" que hoy vive dentro de `_authenticated/asistencia.tsx` (que queda para marcaciones/terminales).

2. **Horarios** — vista semanal tipo grilla por sede (solo lectura + edición rápida).

3. **Festivos** — CRUD de `company_holidays`.

4. **Nómina & Retrasos** — panel administrativo:
   - Filtros: rango de fechas, empleado, sede.
   - Tabla con: empleado, días trabajados, minutos de retraso, descuentos, pago bruto, pago neto.
   - Detalle expandible con historial de retrasos día por día.
   - Botón "Recalcular período".
   - Export CSV (base para futura nómina).

**Sidebar:** añadir entrada "Empleados" (rol admin/supervisor) apuntando a `/empleados`. La ruta `asistencia` actual se conserva para marcaciones.

**Integración con módulo de asistencia:** el registro de `entrada` sigue funcionando igual; un trigger post-insert sobre `attendance_records` (solo `record_type='entrada'`) llama a `compute_daily_late` para ese empleado y ese día, dejando la fila en `attendance_late_records` en tiempo real.

## 4. Reglas de cálculo (resumen)

- Se evalúa **solo `entrada`**. `salida` se ignora para efectos de retraso/descuento.
- Se toma la **primera** entrada del día en zona `America/Bogota`.
- Si `weekly_schedule[dia].works=false` → día no laborable, sin retraso ni descuento.
- Si es festivo (existe en `company_holidays`) → usa clave `festivo`.
- `late_minutes = max(0, real - programada - grace_minutes)`.
- Descuento:
  - `weekly_fixed`: `weekly_salary / (dias_semanales_activos × hours_per_shift × 60) × late_minutes`.
  - `per_shift`: `tarifa_del_día / (hours_per_shift × 60) × late_minutes`.
- Ausencias (día laborable sin entrada) se marcan pero **no** descuentan automáticamente (evita falsos positivos por licencias); el admin puede revisar.

## 5. Compatibilidad y riesgos

- La tabla `attendance_employees` mantiene su columna `schedule` original → cero ruptura del terminal.
- Todas las columnas nuevas son opcionales con defaults.
- Nuevas tablas con RLS + GRANTs correctos.
- Cálculo hecho en Postgres → sin coste extra en cliente y consistente en multi-sede.
- Zona horaria manejada con `timezone('America/Bogota', recorded_at)` dentro de las RPC.
- Sin impacto en POS, ventas, cocina, WhatsApp bot, ni impresión.

## 6. Orden de ejecución

1. Migración SQL (tablas, columnas, RLS, grants, RPCs, trigger).
2. Ruta `/empleados` con las 4 tabs.
3. Item en sidebar.
4. Backfill opcional: copiar `schedule` viejo a `weekly_schedule` cuando exista.

Confirmame para proceder.