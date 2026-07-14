import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ResetCategory =
  | "pedidos"
  | "gastos"
  | "caja"
  | "stock"
  | "clientes"
  | "proveedores"
  | "productos"
  | "modificadores"
  | "insumos"
  | "categorias";

const CategoryZ = z.enum([
  "pedidos",
  "gastos",
  "caja",
  "stock",
  "clientes",
  "proveedores",
  "productos",
  "modificadores",
  "insumos",
  "categorias",
]);

const InputZ = z.object({
  categories: z.array(CategoryZ).min(1),
  branchIds: z.array(z.string().uuid()).nullable().optional(), // null/undefined = todas
  from: z.string().nullable().optional(), // ISO date
  to: z.string().nullable().optional(),
});

const ExecInputZ = InputZ.extend({
  confirmPhrase: z.string(),
  reason: z.string().trim().min(3, "Motivo requerido"),
});

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Solo Administradores pueden reiniciar datos");
}

type Range = { from?: string | null; to?: string | null; branchIds?: string[] | null };

// Devuelve la definición de tablas a tocar por categoría, en orden seguro de borrado.
// Cada entrada: table, filtro por rango (columna), filtro por branch (columna) o null si es global.
type TableSpec = {
  table: string;
  dateCol?: string; // por defecto created_at cuando aplica
  branchCol?: string | null; // null = tabla global, string = columna, undefined = usar 'branch_id'
  // filtro adicional (por ejemplo status)
  extra?: (q: { table: string }) => Record<string, unknown>;
};

const CATEGORY_TABLES: Record<ResetCategory, TableSpec[]> = {
  pedidos: [
    { table: "credit_payments", branchCol: "branch_id" },
    { table: "credits", branchCol: "branch_id" },
    { table: "print_jobs", branchCol: "branch_id" },
    { table: "table_events", branchCol: "branch_id" },
    { table: "waiter_calls", branchCol: "branch_id" },
    // sale_items cascade con sales
    { table: "sales", branchCol: "branch_id" },
  ],
  gastos: [{ table: "expenses", branchCol: "branch_id" }],
  caja: [{ table: "cash_sessions", branchCol: "branch_id", dateCol: "opened_at" }],
  stock: [{ table: "inventory_movements", branchCol: null }],
  clientes: [
    { table: "customer_addresses", branchCol: null },
    { table: "customers", branchCol: null },
  ],
  proveedores: [
    { table: "supplier_credit_payments", branchCol: "branch_id" },
    { table: "supplier_credits", branchCol: "branch_id" },
    { table: "purchase_items", branchCol: null },
    { table: "purchases", branchCol: "branch_id" },
  ],
  productos: [{ table: "products", branchCol: null }],
  modificadores: [
    { table: "modifiers", branchCol: "branch_id" },
    { table: "modifier_groups", branchCol: "branch_id" },
  ],
  insumos: [{ table: "supplies", branchCol: null }],
  categorias: [{ table: "categories", branchCol: null }],
};

function applyRange<T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T; in: (c: string, v: string[]) => T }>(
  q: T,
  spec: TableSpec,
  r: Range,
): T {
  const col = spec.dateCol ?? "created_at";
  if (r.from) q = q.gte(col, r.from);
  if (r.to) q = q.lte(col, r.to);
  if (spec.branchCol !== null && r.branchIds && r.branchIds.length) {
    q = q.in(spec.branchCol ?? "branch_id", r.branchIds);
  }
  return q;
}

async function countTable(spec: TableSpec, r: Range): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin.from(spec.table as never).select("id", { count: "exact", head: true });
  q = applyRange(q as never, spec, r) as never;
  const { count, error } = await q;
  if (error) throw new Error(`Conteo ${spec.table}: ${error.message}`);
  return count ?? 0;
}

export const previewReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => InputZ.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const r: Range = { from: data.from, to: data.to, branchIds: data.branchIds ?? null };
    const perCategory: Record<string, { total: number; tables: { table: string; count: number }[] }> = {};

    for (const cat of data.categories) {
      const specs = CATEGORY_TABLES[cat];
      const tables: { table: string; count: number }[] = [];
      let total = 0;
      for (const s of specs) {
        const c = await countTable(s, r);
        tables.push({ table: s.table, count: c });
        total += c;
      }
      perCategory[cat] = { total, tables };
    }

    // Validaciones bloqueantes
    const warnings: string[] = [];
    const blockers: string[] = [];

    if (data.categories.includes("pedidos") || data.categories.includes("caja")) {
      let openQ = supabaseAdmin.from("cash_sessions").select("id, branch_id", { count: "exact", head: true }).eq("status", "open");
      if (r.branchIds?.length) openQ = openQ.in("branch_id", r.branchIds);
      const { count: openCount } = await openQ;
      if ((openCount ?? 0) > 0) {
        blockers.push(`Hay ${openCount} caja(s) abierta(s). Ciérralas antes de reiniciar.`);
      }
    }

    if (data.categories.includes("pedidos")) {
      let pendQ = supabaseAdmin.from("sales").select("id", { count: "exact", head: true }).in("status", ["open", "pending"]);
      if (r.branchIds?.length) pendQ = pendQ.in("branch_id", r.branchIds);
      const { count: pendCount } = await pendQ;
      if ((pendCount ?? 0) > 0) {
        blockers.push(`Hay ${pendCount} pedido(s) abiertos o pendientes. Ciérralos o cancélalos antes de reiniciar.`);
      }
    }

    for (const cat of ["productos", "categorias", "insumos", "modificadores", "clientes", "proveedores"] as ResetCategory[]) {
      if (data.categories.includes(cat) && !data.categories.includes("pedidos") && (perCategory[cat]?.total ?? 0) > 0) {
        warnings.push(`Al eliminar ${cat} sin eliminar pedidos históricos, los reportes antiguos pueden mostrar referencias huérfanas.`);
      }
    }
    if (data.categories.some((c) => ["productos", "categorias", "insumos", "modificadores"].includes(c))) {
      warnings.push("Catálogos (productos, categorías, insumos, modificadores) son datos globales o por sede: revisa el alcance.");
    }

    return { perCategory, warnings, blockers };
  });

async function fetchTableRows(spec: TableSpec, r: Range) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin.from(spec.table as never).select("*");
  q = applyRange(q as never, spec, r) as never;
  const { data, error } = await q;
  if (error) throw new Error(`Backup ${spec.table}: ${error.message}`);
  return data ?? [];
}

export const backupReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => InputZ.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const r: Range = { from: data.from, to: data.to, branchIds: data.branchIds ?? null };
    const backup: Record<string, Record<string, unknown>[]> = {};
    for (const cat of data.categories) {
      for (const s of CATEGORY_TABLES[cat]) {
        if (backup[s.table]) continue;
        backup[s.table] = await fetchTableRows(s, r);
      }
    }
    return {
      generated_at: new Date().toISOString(),
      generated_by: context.userId,
      scope: { branchIds: data.branchIds ?? null, from: data.from ?? null, to: data.to ?? null },
      categories: data.categories,
      tables: backup,
    };
  });

export const executeReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ExecInputZ.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    if (data.confirmPhrase.trim().toUpperCase() !== "REINICIAR DATOS GOLOSO") {
      throw new Error("La frase de confirmación no coincide.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const r: Range = { from: data.from, to: data.to, branchIds: data.branchIds ?? null };

    // Revalidar bloqueadores
    if (data.categories.includes("pedidos") || data.categories.includes("caja")) {
      let openQ = supabaseAdmin.from("cash_sessions").select("id", { count: "exact", head: true }).eq("status", "open");
      if (r.branchIds?.length) openQ = openQ.in("branch_id", r.branchIds);
      const { count: openCount } = await openQ;
      if ((openCount ?? 0) > 0) throw new Error("No se puede reiniciar: hay cajas abiertas.");
    }
    if (data.categories.includes("pedidos")) {
      let pendQ = supabaseAdmin.from("sales").select("id", { count: "exact", head: true }).in("status", ["open", "pending"]);
      if (r.branchIds?.length) pendQ = pendQ.in("branch_id", r.branchIds);
      const { count: pendCount } = await pendQ;
      if ((pendCount ?? 0) > 0) throw new Error("No se puede reiniciar: hay pedidos abiertos o pendientes.");
    }

    const results: { table: string; deleted: number; error?: string }[] = [];
    for (const cat of data.categories) {
      for (const s of CATEGORY_TABLES[cat]) {
        try {
          let q = supabaseAdmin.from(s.table as never).delete({ count: "exact" });
          q = applyRange(q as never, s, r) as never;
          // Necesitamos un filtro obligatorio para evitar delete-all accidental: si no hay filtros, forzamos id no nulo.
          // supabase-js requiere al menos un filtro; agregamos uno inocuo.
          q = (q as never as { neq: (c: string, v: string) => unknown }).neq("id", "00000000-0000-0000-0000-000000000000") as never;
          const { error, count } = await q;
          if (error) {
            results.push({ table: s.table, deleted: 0, error: error.message });
          } else {
            results.push({ table: s.table, deleted: count ?? 0 });
          }
        } catch (e) {
          results.push({ table: s.table, deleted: 0, error: (e as Error).message });
        }
      }
    }

    // Auditoría
    const totalDeleted = results.reduce((a, b) => a + b.deleted, 0);
    const errors = results.filter((r) => r.error);
    await supabaseAdmin.from("audit_log").insert({
      entity: "system",
      action: "reset_data",
      user_id: context.userId,
      user_name: (context.claims as { name?: string; email?: string } | null)?.name
        ?? (context.claims as { email?: string } | null)?.email
        ?? null,
      branch_id: r.branchIds?.length === 1 ? r.branchIds[0] : null,
      meta: {
        categories: data.categories,
        scope: { branchIds: r.branchIds, from: r.from, to: r.to },
        reason: data.reason,
        results,
        totalDeleted,
        errorCount: errors.length,
      },
    });

    return { ok: errors.length === 0, results, totalDeleted, errors };
  });
