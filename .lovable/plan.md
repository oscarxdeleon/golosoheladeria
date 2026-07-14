
# Módulo REPORTES — Heladería Goloso

Un nuevo centro unificado de consulta financiera, comercial, operativa y de auditoría. Se integra con las tablas existentes (`sales`, `sale_items`, `cash_sessions`, `expenses`, `audit_log`, `branches`, `profiles`, `products`) sin modificar la lógica actual de ventas, caja, inventario ni pedidos.

## 1. Estructura de navegación

En el sidebar aparece un nuevo grupo **REPORTES** (icono BarChart3) con:

- Resumen Financiero → `/reportes/resumen`
- Ventas y Analíticas → `/reportes/ventas`
- Historial y Cajas → `/reportes/cajas`
- Auditorías → `/reportes/auditoria` (ruta actual `/auditoria` se reexporta aquí, manteniendo el archivo original por compatibilidad y agregando alias en el menú).

Permisos (`role_permissions.route_key`):
- `reportes` (raíz), `reportes/resumen`, `reportes/ventas`, `reportes/cajas`, `reportes/auditoria`.
- Admin: acceso total. Cajero: solo sus propios cierres (filtrado por `cash_sessions.opened_by/closed_by = auth.uid()`). Otros roles: sin acceso salvo que el admin lo habilite.

## 2. Resumen Financiero (`/reportes/resumen`)

Panel con KPIs consolidados por sede/rango/usuario/caja/turno:

- Ventas totales, # transacciones, ticket promedio.
- Ingresos, Gastos, Entradas, Salidas, Retiros.
- Propinas (`sales.tip_amount`), Cortesías (items con `is_courtesy` o `discount = total`).
- Saldo neto = Ventas − Gastos − Devoluciones − Reembolsos + Entradas − Salidas.
- Efectivo esperado, Valor declarado, Diferencia (agregados desde `cash_sessions`).

Filtros: rango de fechas (con presets Hoy / Ayer / 7d / Mes), sede, usuario, caja/turno.
Tarjetas modernas con gradient sky→emerald, iconografía Lucide y contadores animados.

## 3. Ventas y Analíticas (`/reportes/ventas`)

- Ventas por día (line), por hora (bar).
- Ventas por sede, usuario, producto, categoría, tipo de servicio, medio de pago (bar/pie).
- Top y bottom productos, ticket promedio, tendencias, comparativo periodo vs periodo anterior (delta %).
- Regla clave: usar `sale_items.product_name` únicamente para el producto principal, **excluyendo modificadores**. Se filtra por `parent_item_id IS NULL` (o `is_modifier = false`) y se agrupa por `product_id` para no fragmentar variantes.

Charts con `recharts` (ya instalado). Filtros globales de sede + rango.

## 4. Historial y Cajas (`/reportes/cajas`)

Tabla con columnas: Sede, Caja, Turno #, Usuario apertura, Fecha/hora apertura, Usuario cierre, Fecha/hora cierre, Estado, Monto inicial, Ventas totales, Valor declarado, Diferencia.

Buscar (texto libre en usuarios/sede), filtros (sede, estado, rango, usuario) y orden por cualquier columna.

Clic en un cierre → `/reportes/cajas/$id` (detalle).

## 5. Detalle de cierre (`/reportes/cajas/$id`)

Componente con pestañas (`Tabs` shadcn):

1. **Resumen** — # pedidos, ventas totales, ticket promedio, cancelados, cortesías, propinas, duración, usuarios apertura/cierre.
2. **Medios de pago** — Efectivo / Nequi / Bancolombia / Tarjeta / Transferencia / Otros. Valor + # transacciones + totales.
3. **Declarado** — declarado por método vs esperado, con delta por método.
4. **Tipo de servicio** — Mesa / Llevar / Domicilio / Online / Kiosko: # pedidos y valor.
5. **Balance efectivo** — Apertura + Ventas efectivo + Entradas − Salidas − Gastos − Retiros − Devoluciones = **Efectivo esperado**.
6. **Productos** — nombre, cantidad, total. Solo producto principal, agrupado por `product_id`, ordenado desc por cantidad. Totales al pie.
7. **Ajustes** — Entradas, Salidas, Gastos, Devoluciones, Reembolsos con fecha/hora/usuario/motivo/valor + subtotales.

Al final del detalle: tres tarjetas grandes → **Valor esperado / Valor declarado / Diferencia** con semáforo (🟢 cuadró | 🟠 sobrante | 🔴 faltante).

Botón **Descargar PDF** (icono Download) que genera vía `jsPDF + jspdf-autotable` un PDF con: logo Goloso, sede, turno #, usuarios, fecha/hora, resumen, ventas, medios de pago, productos, balance, ajustes, valores esperado/declarado/diferencia. Diseño limpio, A4, listo para impresión.

## 6. Auditorías

La ruta `/auditoria` existente se mantiene funcional; se agrega ruta espejo `/reportes/auditoria` que renderiza el mismo componente `AuditoriaPage`. El sidebar solo expone la nueva ubicación dentro de REPORTES.

## 7. Fuente única de datos

Todos los cálculos se derivan de un helper compartido `src/lib/reports.ts` que:
- Consulta `sales`, `sale_items`, `cash_sessions`, `expenses` de forma consistente.
- Aplica el filtro anti-modificadores en un solo lugar.
- Exporta funciones `getShiftSummary(sessionId)`, `getFinancialSummary(filters)`, `getSalesAnalytics(filters)` reutilizadas por Dashboard/Caja/Ventas/Reportes para garantizar coincidencia entre módulos.

## 8. Diseño

Tarjetas rounded-2xl, sombras suaves (`shadow-elegant`), gradients corporativos ya definidos, tipografía `font-display` para titulares, responsive grid (`md:grid-cols-2 lg:grid-cols-4`), tablas con `Table` shadcn, gráficos `recharts` con tokens semánticos.

## Detalles técnicos

- Rutas nuevas: `src/routes/_authenticated/reportes/route.tsx` (layout con `<Outlet/>`), `resumen.tsx`, `ventas.tsx`, `cajas.tsx`, `cajas.$id.tsx`, `auditoria.tsx`.
- Sidebar: editar `src/components/app-sidebar.tsx` — nuevo grupo REPORTES; ocultar el enlace suelto a "Auditoría" dentro de Administración.
- Permisos: migración SQL agregando `route_key` `reportes*` a `role_permissions` (admin habilitado por defecto).
- Helper: `src/lib/reports.ts` con tipos + queries.
- PDF: `src/lib/shift-pdf.ts` usando `jspdf` y `jspdf-autotable` (verificar/instalar).
- Charts: `recharts` (ya en `package.json`).
- Data: no se cambian esquemas de negocio; solo se consultan tablas existentes. Si falta alguna columna (p.ej. `is_courtesy`), se derivará (`discount >= subtotal`).

## Fuera de alcance

- No se rediseña Caja ni Dashboard actuales (solo se opcionalmente pueden migrar a usar `reports.ts` en un paso posterior).
- No se toca el flujo de cierre en `caja.tsx`; solo se lee histórico.

¿Apruebas para implementar?
