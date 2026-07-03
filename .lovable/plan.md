## Objetivo

Simplificar los modificadores en POS, Kiosko y Menú en línea:

- **Producto sin modificadores** → se agrega directo (ya funciona así).
- **Producto con exactamente 1 modificador opcional** → no abre modal. Se muestra un mini-popover (anclado al botón "Agregar" del producto) con un solo checkbox `☐ Agregar {nombre} (+$xxx)` y botón **Agregar**. Un solo clic si no se quiere el extra.
- **Producto con >1 modificador o grupos con reglas** → abre el modal actual, pero rediseñado por grupo:
  - `max_select = 1` → **radio buttons** (selección única).
  - `max_select > 1` o `= 0` → **checkboxes** (múltiple), respetando `min_select`, `max_select` y `required`.
  - Se mantiene el input de nota opcional y el total dinámico.

## Detalles técnicos

1. **`src/components/modifiers-modal.tsx`** — refactor interno:
   - Reemplazar los botones `+ / −` por `RadioGroup` cuando `max_select === 1` y por `Checkbox` cuando `max_select !== 1`.
   - Deshabilitar checkboxes cuando se alcanza `max_select`.
   - Conservar la firma pública (`product`, `onClose`, `onConfirm`) → sin cambios en llamadas.
   - Conservar validación (`min_select`, `required`, `max_select`) y cálculo de `unitExtra`.
   - Conservar `buildLineLabel` para carrito/orden/factura.

2. **Nuevo componente `src/components/single-modifier-popover.tsx`**:
   - Popover pequeño con un checkbox + botón `Agregar · $total`.
   - Recibe `product`, `modifier` (el único), y `onConfirm(mods, unitExtra)` con la misma forma que el modal.

3. **Nuevo hook `src/hooks/use-modifier-catalog.ts`**:
   - Recibe la lista de `group_ids` visibles.
   - Devuelve mapas `groupsById` y `modsByGroupId` en una sola consulta cacheada por `React Query`.
   - Función helper `resolveProductModifiers(product)` → `{ kind: "none" | "single-optional" | "multi", singleMod?, groups, mods }`.

4. **`src/components/pos-screen.tsx`** y **`src/components/public-order.tsx`** (este último también sirve al Kiosko y al menú por mesa):
   - Usar `useModifierCatalog` con todos los `group_ids` de los productos cargados.
   - Al presionar "Agregar" en un producto:
     - `none` → agregar directo (comportamiento actual).
     - `single-optional` → abrir `SingleModifierPopover` anclado al botón; al confirmar, agregar con o sin el modificador según el checkbox.
     - `multi` → abrir `ModifiersModal` (como hoy).
   - Reemplaza la condición actual `modifier_group_ids?.length > 0` en los 3 handlers de POS (líneas 1313, 1346, 1371) y en el handler de public-order (línea 203).

5. **Sin cambios de base de datos**. Se usan `modifier_groups.min_select / max_select / required` que ya existen.

## Compatibilidad

- Productos existentes siguen funcionando sin migración.
- El carrito, ticket, KDS y factura reciben la misma estructura `SelectedModifier[]` que hoy.
- Diseño visual actual conservado (mismos componentes `Dialog`, `Popover`, `Checkbox`, `RadioGroup` de shadcn).

## Alternativa (si prefieres)

En vez del popover, mantener modal también para el caso de 1 modificador, pero mostrarlo como una tarjeta mínima con un solo checkbox. Es visualmente casi lo mismo pero **sí abre una ventana** — no cumple estrictamente tu requisito de "no abrir ventana de selección".

Confirmo el plan con **popover inline** para el caso de 1 modificador opcional, ¿procedo?
