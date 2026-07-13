// Sincronización realtime por sede: escucha cambios en `restaurant_tables`,
// `sales` y `sale_items` para invalidar de inmediato las queries que
// alimentan el mapa de mesas y la pantalla POS. Elimina la necesidad de
// polling y hace que un pedido guardado desde la tablet aparezca en el POS
// del cajero prácticamente al instante.

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Opts {
  /** Si es true, además invalida `pending-sale` (usado por PosScreen). */
  invalidatePendingSale?: boolean;
}

export function useRealtimeBranchSync(branchId: string | null | undefined, opts: Opts = {}) {
  const qc = useQueryClient();
  const invalidatePendingSale = opts.invalidatePendingSale === true;

  useEffect(() => {
    if (!branchId) return;

    const invalidateTables = () => {
      void qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
    };
    const invalidateSales = () => {
      void qc.invalidateQueries({ queryKey: ["sales"] });
      if (invalidatePendingSale) {
        void qc.invalidateQueries({ queryKey: ["pending-sale"] });
      }
    };
    const invalidateBoth = () => {
      invalidateTables();
      invalidateSales();
      // KDS y llevar-pendientes también leen de sale_items/sales
      void qc.invalidateQueries({ queryKey: ["kds-pending"] });
    };

    const channel = supabase
      .channel(`branch-sync-${branchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restaurant_tables", filter: `branch_id=eq.${branchId}` },
        invalidateTables,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${branchId}` },
        invalidateBoth,
      )
      // sale_items no tiene branch_id; el filtro por sede lo aplican las queries que se invaliden.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sale_items" },
        invalidateSales,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [branchId, qc, invalidatePendingSale]);
}
