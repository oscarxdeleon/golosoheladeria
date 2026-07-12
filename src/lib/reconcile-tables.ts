import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Autocorrección de mesas. Llama al RPC `reconcile_restaurant_tables` que:
 *  - Detecta mesas marcadas como "Ocupadas" sin ningún pedido activo asociado
 *    (pending / confirmed / ready) y las libera automáticamente.
 *  - Registra cada corrección en `audit_log` y en `table_events` con motivo,
 *    número de mesa, estado anterior, estado corregido, fecha y hora.
 *
 * Se puede ejecutar por sede (`branchId`) o sobre todas las mesas visibles
 * para el usuario. Retorna la cantidad de mesas corregidas.
 */
export async function reconcileTables(
  branchId?: string | null,
  opts: { silent?: boolean } = {},
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("reconcile_restaurant_tables", {
      _branch_id: branchId ?? null,
    });
    if (error) {
      // Silencioso: es una tarea de mantenimiento, no debe romper la UI.
      if (!opts.silent) console.warn("[reconcileTables] error", error.message);
      return 0;
    }
    const payload = (data ?? {}) as { fixed_count?: number };
    const count = payload.fixed_count ?? 0;
    if (count > 0 && !opts.silent) {
      toast.info(
        count === 1
          ? "1 mesa liberada automáticamente (sin pedidos activos)"
          : `${count} mesas liberadas automáticamente (sin pedidos activos)`,
      );
    }
    return count;
  } catch (err) {
    if (!opts.silent) console.warn("[reconcileTables] exception", err);
    return 0;
  }
}
