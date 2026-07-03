## Objetivo

Cada sucursal tiene su propia copia de cada producto, pero por defecto **hereda automáticamente** los cambios que se hagan en la sede principal (GOLOSO SANTA). El usuario puede en cualquier momento **desvincular** un producto en una sucursal para editarlo individualmente, o **volver a sincronizarlo** con la principal.

## Modelo de datos

Se agregan dos columnas a `products`:

- `source_product_id` (uuid, nullable) → apunta al producto "padre" en la sede principal. NULL = es un producto principal (no hereda).
- `is_linked` (bool, default true) → si está en true y tiene padre, hereda cambios automáticamente. Si el usuario edita el producto en la sucursal, se pone en false.

Ventaja: no rompe consultas existentes. Cada fila sigue teniendo su propio precio, foto, stock, categoría; los filtros por `available_branch_ids` siguen funcionando.

## Migración inicial (una sola vez)

Para cada producto existente:
1. La fila original queda como producto de la sede principal (`available_branch_ids = [GOLOSO SANTA]`).
2. Se crea una copia idéntica para GOLOSO PARQUE con `source_product_id = id_original`, `is_linked = true`, `available_branch_ids = [GOLOSO PARQUE]`, stock inicial en 0.

Así ambas sedes ven exactamente los mismos productos y todo cambio en la principal se propaga.

## Propagación automática (trigger)

Cuando se actualiza un producto principal, un trigger de base de datos copia los cambios a **todos sus hijos vinculados** (`is_linked = true`). Campos propagados:

- nombre, precio, foto, categoría, sku, favorito, mostrar en línea, modificadores, activo, receta, sold_by_weight, min_stock, track_stock

**NO se propaga:** `stock` (inventario propio por sede), `available_branch_ids` (define a qué sede pertenece cada fila).

## UI en la pantalla de productos

En el listado y editor de productos:

- Badge visible: **"Vinculado a principal"** (hereda) o **"Personalizado"** (desvinculado).
- Si el producto es hijo y está vinculado: al guardar cambios manuales, se muestra confirmación *"Este producto se está editando y dejará de sincronizarse con la sede principal. ¿Continuar?"* → al aceptar, `is_linked = false`.
- Botón **"Volver a sincronizar con principal"** en productos desvinculados: copia todos los campos del padre y vuelve a poner `is_linked = true`.
- Los productos principales muestran una nota informativa: *"Los cambios se aplicarán automáticamente a las sucursales vinculadas"*.

## Creación de productos nuevos

Cuando se crea un producto en la sede principal, se crea automáticamente una copia vinculada en cada sucursal existente. Cuando se crea un producto directamente en una sucursal (no en la principal), queda como producto independiente sin padre.

## Modificadores y categorías

Permanecen **compartidos globalmente** entre sedes, sin cambios. (Confirmado por el usuario.)

## Detalles técnicos

- Migración SQL agrega columnas + trigger `AFTER UPDATE ON products` que hace `UPDATE products SET ... WHERE source_product_id = OLD.id AND is_linked = true`.
- Trigger `AFTER INSERT ON products` cuando `source_product_id IS NULL AND available_branch_ids incluye principal`: crea copias vinculadas en las demás sedes.
- Backfill: script SQL que duplica cada producto actual para GOLOSO PARQUE y ajusta `available_branch_ids`.
- Sin cambios en KDS, POS runtime, ventas ni tickets: cada venta sigue referenciando el `product_id` de la fila de su sede.
- Índice en `source_product_id` para propagación rápida.

## Archivos afectados

- Nueva migración SQL (columnas, trigger, backfill).
- `src/routes/_authenticated/menu/productos.tsx` (o equivalente): badge, confirmación al editar hijo vinculado, botón resincronizar.
- Regeneración de `src/integrations/supabase/types.ts` tras migración.

## Fuera de alcance

- Herencia parcial por campo (todo o nada por producto).
- UI de "ver todas las sucursales vinculadas a este producto" (se puede agregar después).
