# Plan enterprise para el POS Goloso

Este bloque son **14 mejoras muy grandes**. Meterlas todas de golpe rompería lo que ya funciona. Antes de escribir código, te propongo un análisis honesto de qué es factible, qué es enorme y qué ya lo cubre la plataforma, y luego lo hacemos por fases.

## Análisis por punto

| # | Mejora | Complejidad | Recomendación |
|---|---|---|---|
| 1 | **Modo Offline Inteligente** | 🔴 Muy alta (2-3 semanas de trabajo) | Fase 3 — requiere IndexedDB + service worker + cola de operaciones + reescribir ~15 pantallas para leer/escribir contra caché local. Ver notas abajo. |
| 2 | **Sincronización Automática** | 🔴 Muy alta | Fase 3 — inseparable de #1. |
| 3 | **Prevención de conflictos** | 🔴 Alta | Fase 3 — depende de #1 y #2. |
| 4 | **Indicador de estado (🟢🔴🟡)** | 🟢 Baja | **Fase 1**, sí. Incluso sin offline completo puede mostrar estado online/offline y pings a Supabase. |
| 5 | **Recuperación tras fallos** | 🟡 Media | **Fase 1** parcial: ya funciona porque todo está en la nube (mesas abiertas, cajas, pedidos persisten). Añadiremos "reanudar borrador de venta" con `localStorage`. |
| 6 | **Backups automáticos** | ⚫ Plataforma | Lovable Cloud ya hace backups diarios (7 días de retención en plan gratuito, más en pagos). No podemos exponer un botón "descargar backup" al usuario final. Sí podemos añadir **exportar CSV** de ventas/inventario/clientes. |
| 7 | **Auditoría avanzada** | 🟢 Baja-Media | **Fase 1**. Ya tenemos triggers para productos/categorías/modificadores. Añadir: login/logout, apertura/cierre caja, cancelaciones, descuentos, cortesías, reimpresiones, cambios de precio. IP y equipo solo cuando se registran del lado cliente (no siempre disponible). |
| 8 | **Optimización de rendimiento** | 🟡 Media | **Fase 2**. Analizar queries lentas (`pg_stat_statements`), añadir índices, revisar `useEffect` costosos y renders innecesarios. |
| 9 | **Monitoreo interno** | 🟡 Media | **Fase 2**. Panel `/monitoreo` con: latencia DB, estado impresoras (usa el print-server actual), heartbeat Internet, últimas fallas. |
| 10 | **Mejoras de seguridad** | 🟡 Media | **Fase 1**. Revisar RLS "USING (true)" preexistentes, forzar recheck de rol en operaciones críticas, registrar intentos fallidos, limpiar warnings del linter Supabase. |
| 11 | **Optimización de impresión** | 🟡 Media | **Fase 2**. Ya hay print-server; revisar timeouts, reintentos, cola. Solo lo que se pueda del lado app. |
| 12 | **Validaciones generales** | 🟡 Media | **Fase 4** — pruebas end-to-end con Playwright de los 12 flujos. |
| 13 | **Pruebas de estrés** | 🟡 Media | **Fase 4**. Simular volumen con scripts SQL + Playwright. |
| 14 | **Revisión final** | 🟡 Media | **Fase 4**. Rondas de bugfixes visuales y de lógica. |

## Notas técnicas importantes (léelas antes de aprobar)

**Modo offline (puntos 1-3):** el POS actual es un SPA que lee y escribe Supabase en cada acción. Para trabajar sin Internet hay que:

1. Cambiar todas las lecturas críticas (productos, categorías, modificadores, mesas, clientes) para servirse desde IndexedDB con `refresh` en background.
2. Añadir una **cola de escrituras** (ventas, sale_items, movimientos de caja, sesiones) que se guarde local y se reproduzca contra Supabase cuando vuelve la red.
3. Reescribir las funciones SQL críticas (`open_cash_session`, cierre de venta, etc.) para tolerar reenvío con **idempotency key** (UUID generado en cliente) — si no, cada reintento crearía duplicados.
4. Cambiar el KDS/Cocina/Pedidos-online: en offline no pueden llegar pedidos nuevos, y los que llegaron antes deben seguir procesables local.
5. La impresión ya funciona sin Internet (print-server local), pero el disparo actual depende de listener Supabase Realtime — hay que añadir camino directo cliente → print-server.

Realista: **2-3 semanas de desarrollo dedicado**. Recomiendo empezar por Fase 1-2, medir cuánto tiempo real está Heladería Goloso sin Internet, y decidir si vale la inversión.

**Backups (punto 6):** Lovable Cloud gestiona backups a nivel de infraestructura. No podemos "elegir destino" (Google Drive, USB, etc.) desde la app sin conectar servicios de terceros. Lo que sí podemos: **exportador manual** (ventas del día/mes → CSV, inventario completo → CSV, clientes → CSV) descargable con un clic. Si quieres backup a Drive/S3 dime y montamos integración específica.

**Dirección IP en auditoría:** solo se puede capturar en operaciones que pasan por server functions (server routes). Las escrituras directas desde `supabase-js` en el navegador no tienen IP disponible sin proxy — capturaríamos IP solo en las acciones críticas que ruteemos por server functions.

**Optimización profunda (puntos 8, 11, 13):** requiere baseline real. Necesito **logs reales de uso** (qué se abre más lento, qué falla) antes de optimizar a ciegas — de lo contrario "optimizo" cosas que nadie usa.

## Fases propuestas

### Fase 1 — Base sólida (2-3 turnos)
- Indicador de estado online/offline en el header (#4).
- Reanudar borrador de venta desde localStorage tras cierre inesperado (#5 parcial).
- Auditoría ampliada (#7): login/logout, apertura/cierre caja, cancelaciones, descuentos, cortesías, reimpresión de tickets, cambios de precio en productos.
- Endurecer seguridad (#10): revisar policies `USING (true)`, exigir rol en RPC sensibles, registrar intentos fallidos de login.

### Fase 2 — Rendimiento y monitoreo (2-3 turnos)
- Analizar `pg_stat_statements`, añadir índices donde impacten.
- Reducir renders costosos en POS y KDS (React DevTools guía).
- Pantalla `/monitoreo` para admin: heartbeat DB, últimos errores, estado del print-server, tamaño de tablas.
- Cola de impresión con reintentos + auditoría de reimpresiones (#11).

### Fase 3 — Modo offline (semanas, opcional)
- Solo si Fase 1-2 no bastan. Requiere decidir alcance: solo POS (venta rápida) o todo el sistema.
- Implementación con IndexedDB + service worker + cola idempotente.

### Fase 4 — QA y estrés
- Batería Playwright de los 12 flujos.
- Seeds de estrés (1000 ventas/día, 50 mesas) y medir.
- Ronda final de pulido.

## Lo que necesito de ti antes de empezar

1. ¿Empezamos por **Fase 1** o quieres ajustar prioridades?
2. Modo offline (#1-3): ¿Es urgente ahora, o probamos primero Fase 1-2 y decidimos después? (Recuerda: son 2-3 semanas de trabajo).
3. Backups: ¿Te sirve el **exportador CSV manual**, o necesitas backup automático a un servicio externo (dime cuál)?
4. ¿Alguna sede tiene **problemas frecuentes de Internet** hoy? Si sí, cuánto tiempo (minutos/horas al día) — esto define si offline es urgente o "por si acaso".

Cuando confirmes, arranco con la fase que elijas y sigo el ritmo de "puedes seguir" turno por turno.