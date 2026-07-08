## Nueva sección "Comandas" en Ajustes → Impresoras

Añadir un editor de formatos de comanda personalizables, con vista previa en vivo, guardado en base de datos y aplicación automática vía Print Server — sin tocar la lógica de pedidos, precuentas ni tickets de venta.

### Alcance funcional

1. Nueva pestaña **"Comandas"** dentro del hub `Ajustes → Impresoras` (subnav interno, sin nueva ruta).
2. **3 formatos predefinidos** editables: `Clásico`, `Compacto`, `Grande / Legible`. Uno marcado como activo.
3. Cada formato permite editar:
   - Tipo de letra (Fuente A / Fuente B ESC/POS)
   - Tamaño título, nombre de producto, modificadores (1×–4× alto/ancho)
   - Negrita on/off por sección
   - Alineación (encabezado, productos, tipo pedido, mesa)
   - Estilo de separador (`-`, `=`, `*`, línea vacía)
   - Espaciado entre líneas (0–3 saltos)
   - Márgenes izquierdo/derecho (0–4 espacios)
   - Estilo de modificadores (una línea `+A +B +C` / lista `  + A`)
   - Formato del número de pedido (`#123`, `PEDIDO 123`, `TICKET #123`)
   - Formato de mesa (`MESA 4`, `Mesa: 4`, `M4`)
   - Formato tipo pedido (`PARA MESA`, `>> MESA`, oculto)
   - Formato de cantidad (`2x`, `2×`, `(2)`)
4. **Vista previa** en pantalla que renderiza en `<pre>` con fuente monoespaciada, ancho 42/48 chars, mostrando encabezado + 2 productos con modificadores + observaciones + separadores según la config.
5. Al guardar → se persiste en `settings.command_formats` (jsonb) + `settings.command_format_active` (text). Aplicación instantánea sin reinicio.
6. Print Server lee la config activa desde el `PrintPayload.command_format` que el cliente envía en cada impresión (bootstrap desde `settings`). No requiere reinstalar el server.

### Cambios técnicos

**DB (migration)**:
- `settings.command_formats jsonb DEFAULT '{...3 presets...}'::jsonb`
- `settings.command_format_active text DEFAULT 'clasico'`

**Front-end**:
- Nuevo componente `src/components/ajustes/comandas-format-tab.tsx` con editor + preview.
- Modificar `ajustes.tsx` `ImpresorasTab` para añadir subnav (Tabs) con: "Impresoras", "Comandas", "Caja / Comprobantes".
- `src/lib/print-client.ts`: cargar `command_formats`/`command_format_active` una vez (cache) e inyectarlos en cada `PrintPayload` (`command_format: {...}`) cuando `type === "comanda"`.

**Print Server (`print-server/server.js`)**:
- Cuando recibe `type=comanda` con `command_format`, usa esos valores para: font, size (GS ! n), align (ESC a), separator char + width, line spacing (ESC 3), left margin (ESC l), formatos de header/mesa/pedido/cantidad, orden de modificadores.
- Fallback al layout actual si `command_format` está ausente (retrocompat).
- Bump a **v2.5.0**.

**Sin cambios en**: precuenta, ticket, drawer, tickets de venta, lógica POS.

### Estructura de datos del formato

```json
{
  "font": "A",            // "A" | "B"
  "titleSize": 2,         // 1..4
  "productSize": 1,
  "modifierSize": 1,
  "bold": { "title": true, "product": true, "modifier": false },
  "align": { "header": "center", "product": "left", "orderType": "center" },
  "separator": { "char": "-", "blankLines": 0 },
  "lineSpacing": 0,       // 0..3 saltos extra
  "margins": { "left": 0, "right": 0 },
  "modifiersLayout": "inline",  // "inline" | "list"
  "quantityFormat": "x",   // "x" | "times" | "paren"
  "orderNumberFormat": "hash",  // "hash" | "pedido" | "ticket"
  "tableFormat": "MESA N",       // "MESA N" | "Mesa: N" | "MN"
  "orderTypeFormat": "prefix"    // "prefix" | "arrow" | "hidden"
}
```

### Validación

- Verificar preview coincide con impresión (revisión visual).
- Cambiar formato activo → siguiente comanda imprime con nuevo formato sin reiniciar.
- Print Server v2.5.0 con retrocompat: comandas sin `command_format` siguen imprimiendo igual.
