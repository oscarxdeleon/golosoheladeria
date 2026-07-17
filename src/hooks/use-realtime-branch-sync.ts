// Sincronización realtime por sede: escucha cambios en `restaurant_tables`,
// `sales` y `sale_items` para invalidar de inmediato las queries que
// alimentan el mapa de mesas y la pantalla POS. Elimina la necesidad de
// polling y hace que un pedido guardado desde la tablet aparezca en el POS
// del cajero prácticamente al instante.

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type TableRealtimeRow = {
  id?: string;
  branch_id?: string | null;
  [key: string]: unknown;
};

type TableRealtimePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE" | string;
  new: TableRealtimeRow;
  old: TableRealtimeRow;
};

interface Opts {
  /** Si es true, además invalida `pending-sale` (usado por PosScreen). */
  invalidatePendingSale?: boolean;
}

export function useRealtimeBranchSync(branchId: string | null | undefined, opts: Opts = {}) {
  const qc = useQueryClient();
  const invalidatePendingSale = opts.invalidatePendingSale === true;

  useEffect(() => {
    if (!branchId) return;

    const scopedTablesKey = ["restaurant_tables", branchId] as const;

    const syncTableCache = (payload: TableRealtimePayload) => {
      qc.setQueryData<TableRealtimeRow[]>(scopedTablesKey, (current) => {
        if (!current) return current;

        const row = payload.eventType === "DELETE" ? payload.old : payload.new;
        const id = row?.id;
        if (!id) return current;

        if (payload.eventType === "DELETE") {
          return current.filter((table) => table.id !== id);
        }

        if (payload.new?.branch_id && payload.new.branch_id !== branchId) {
          return current.filter((table) => table.id !== id);
        }

        const nextRow = payload.new;
        const existingIndex = current.findIndex((table) => table.id === id);
        if (existingIndex === -1) return [...current, nextRow];

        const next = [...current];
        next[existingIndex] = { ...next[existingIndex], ...nextRow };
        return next;
      });
    };

    const invalidateTables = () => {
      void qc.invalidateQueries({ queryKey: scopedTablesKey });
      void qc.invalidateQueries({ queryKey: ["dashboard-shared"] });
    };
    const invalidateSales = () => {
      void qc.invalidateQueries({ queryKey: ["sales"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-shared"] });
      void qc.invalidateQueries({ queryKey: ["dash-inv-alerts"] });
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
      void qc.invalidateQueries({ queryKey: ["dash-inv-alerts"] });
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

    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      // Cada montaje usa un tópico único. Así evitamos reutilizar accidentalmente
      // un canal ya suscrito (Realtime no permite agregar callbacks después de
      // `subscribe()` y eso estaba tumbando /mesas en GOLOSO PARQUE).
      channel = supabase.channel(`branch-sync-${branchId}-${Date.now()}-${Math.random().toString(36).slice(2)}`);

      channel
        .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restaurant_tables", filter: `branch_id=eq.${branchId}` },
        (payload) => {
          syncTableCache(payload as TableRealtimePayload);
          invalidateTables();
        },
        )
        .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${branchId}` },
        invalidateBoth,
        )
        .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sale_items", filter: `branch_id=eq.${branchId}` },
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
          void qc.invalidateQueries({ queryKey: ["dash-inv-alerts"] });
        },
        )
        .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        () => {
          void qc.invalidateQueries({ queryKey: ["products"] });
          void qc.invalidateQueries({ queryKey: ["products-all"] });
          void qc.invalidateQueries({ queryKey: ["public-products"] });
          void qc.invalidateQueries({ queryKey: ["dash-inv-alerts"] });
          void qc.invalidateQueries({ queryKey: ["stats-all"] });
        },
        );

      void channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Al reconectar, fuerza una lectura limpia por si hubo eventos perdidos
          // mientras la tablet estuvo suspendida o la red WiFi cambió.
          void qc.refetchQueries({ queryKey: scopedTablesKey, type: "active" });
          void qc.refetchQueries({ queryKey: ["sales"], type: "active" });
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.warn("Sincronización realtime intermitente; usando refresco automático", status);
          invalidateTables();
          invalidateSales();
        }
      });
    } catch (error) {
      console.error("No se pudo iniciar la sincronización realtime de la sede", error);
      if (channel) {
        void supabase.removeChannel(channel);
      }
      return;
    }

    return () => {
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [branchId, qc, invalidatePendingSale]);
}
