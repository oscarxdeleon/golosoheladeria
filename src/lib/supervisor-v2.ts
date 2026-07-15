import { supabase } from "@/integrations/supabase/client";

type Rpc = { rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }> };
const rpc = supabase as unknown as Rpc;

function guard<T>(res: { data: T | null; error: { message: string } | null }, msg = "Error"): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null || res.data === undefined) throw new Error(msg);
  return res.data;
}

export type SupBranch = { id: string; name: string; is_main: boolean };
export type SupSession = {
  session_token: string;
  expires_at: string;
  display_name: string;
  supervisor_id: string;
};
export type SupContext = {
  supervisor: { id: string; display_name: string };
  branches: SupBranch[];
  default_branch_id: string | null;
  session_expires_at: string;
};

export type SupDashboard = {
  range: { start: string; end: string };
  total: number;
  txs: number;
  avg: number;
  gastos: number;
  utilidad: number;
  qty_vendida: number;
  methods: Array<{ name: string; ingresos: number; egresos: number; neto: number; total: number }>;
  top: Array<{ name: string; qty: number; total: number }>;
  hourly: Array<{ hour: number; total: number }>;
  best_days: Array<{ dow: number; total: number }>;
  real_cash: {
    efectivo: number; nequi: number; bancolombia: number;
    efectivoEsperado: number; nequiEsperado: number; bancolombiaEsperado: number;
    diferenciaEfectivo: number; diferenciaNequi: number; diferenciaBanco: number;
    cajasCerradas: number;
  } | null;
  active_cash: Record<string, unknown> | null;
  pending: { tables_occupied: number; pending_llevar: number; pending_domicilio: number; preparing: number };
};

export type SupCashListItem = {
  id: string; branch_id: string; branch_name: string | null;
  opened_at: string; closed_at: string | null;
  opening_amount: number | null; counted_amount: number | null;
  expected_amount: number | null; difference: number | null;
  status: string | null; user_name: string | null;
  sales_total: number;
};

export type SupCashDetail = {
  session: {
    id: string; branch_id: string; branch_name: string | null;
    opened_at: string; closed_at: string | null;
    opening_amount: number | null; counted_amount: number | null;
    expected_amount: number | null; difference: number | null;
    user_name: string | null; status: string | null;
    opening_notes: string | null; closing_notes: string | null;
  };
  summary: {
    total_sales: number; order_count: number; avg_ticket: number;
    cancelled_count: number; cancelled_value: number;
    cash_sales: number; entries_cash: number; expenses_cash: number; purchases_cash: number;
    opening_amount: number; expected_cash: number; counted_amount: number; difference: number;
    nequi_counted: number; bancolombia_counted: number;
  };
  payments: Record<string, { amount: number; count: number }>;
  services: Record<string, { amount: number; count: number }>;
  products: Array<{ name: string; qty: number; total: number }>;
  entradas: Array<Movement>;
  salidas: Array<Movement>;
  devoluciones: Array<Movement>;
  deposits: Array<Movement>;
};

export type Movement = {
  id: string; kind: string; amount: number;
  category?: string | null; description?: string | null;
  method?: string | null; user_name?: string | null;
  status?: string | null; created_at: string;
};

export async function supLogin(display_name: string, pin: string): Promise<SupSession> {
  return guard(await rpc.rpc<SupSession>("supervisor_login_by_name_rpc", {
    _display_name: display_name, _pin: pin,
    _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  }), "No se pudo iniciar sesión");
}

export async function supValidate(token: string): Promise<SupContext> {
  return guard(await rpc.rpc<SupContext>("supervisor_validate_session_rpc", { _session_token: token }), "Sesión inválida");
}

export async function supLogout(token: string) {
  await rpc.rpc("supervisor_logout_rpc", { _session_token: token });
}

export async function supDashboard(token: string, branch_id: string, range: "hoy" | "ayer" | "semana" | "mes"): Promise<SupDashboard> {
  return guard(await rpc.rpc<SupDashboard>("supervisor_dashboard_v2_rpc", {
    _session_token: token, _branch_id: branch_id, _range: range, _origen: "all", _pago: "all",
  }), "No se pudo cargar el dashboard");
}

export async function supCashList(token: string, branch_id: string, from?: string, to?: string): Promise<SupCashListItem[]> {
  return guard(await rpc.rpc<SupCashListItem[]>("supervisor_cash_sessions_list_rpc", {
    _session_token: token, _branch_id: branch_id,
    _from: from ?? null, _to: to ?? null,
  }), "No se pudieron cargar los cierres");
}

export async function supCashDetail(token: string, cash_session_id: string): Promise<SupCashDetail> {
  return guard(await rpc.rpc<SupCashDetail>("supervisor_cash_session_detail_v2_rpc", {
    _session_token: token, _cash_session_id: cash_session_id,
  }), "No se pudo cargar el cierre");
}
