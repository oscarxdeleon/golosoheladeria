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
      void qc.invalidateQueries({ queryKey: ["dashboard-shared"] });
    };
    const invalidateSales = () => {
      void qc.invalidateQueries({ queryKey: ["sales"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-shared"] });
      void qc.invalidateQueries({ queryKey: ["reportes.sales"] });
      void qc.invalidateQueries({ queryKey: ["reportes.cajas.rpc"] });
      void qc.invalidateQueries({ queryKey: ["reportes.session.detail"] });
      void qc.invalidateQueries({ queryKey: ["stats-all"] });
      if (invalidatePendingSale) {
        void qc.invalidateQueries({ queryKey: ["pending-sale"] });
      }
    };
    const invalidateMoney = () => {
      void qc.invalidateQueries({ queryKey: ["dashboard-shared"] });
      void qc.invalidateQueries({ queryKey: ["reportes.sales"] });
      void qc.invalidateQueries({ queryKey: ["reportes.expenses"] });
      void qc.invalidateQueries({ queryKey: ["reportes.purchases"] });
      void qc.invalidateQueries({ queryKey: ["reportes.sessions"] });
      void qc.invalidateQueries({ queryKey: ["reportes.session-options"] });
      void qc.invalidateQueries({ queryKey: ["reportes.cajas.rpc"] });
      void qc.invalidateQueries({ queryKey: ["reportes.session.detail"] });
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses", filter: `branch_id=eq.${branchId}` },
        invalidateMoney,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cash_deposits", filter: `branch_id=eq.${branchId}` },
        invalidateMoney,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchases", filter: `branch_id=eq.${branchId}` },
        invalidateMoney,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchase_items" },
        invalidateMoney,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cash_sessions", filter: `branch_id=eq.${branchId}` },
        invalidateMoney,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "table_events", filter: `branch_id=eq.${branchId}` },
        invalidateTables,
      )
      // Catálogo: si el Admin activa/desactiva una categoría o producto,
      // el POS del Cajero y la tablet de Meseros deben reflejarlo al instante
      // sin necesidad de recargar.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "categories" },
        () => {
          void qc.invalidateQueries({ queryKey: ["categories"] });
          void qc.invalidateQueries({ queryKey: ["categories-all"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        () => {
          void qc.invalidateQueries({ queryKey: ["products"] });
          void qc.invalidateQueries({ queryKey: ["products-all"] });
          void qc.invalidateQueries({ queryKey: ["public-products"] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [branchId, qc, invalidatePendingSale]);
}
