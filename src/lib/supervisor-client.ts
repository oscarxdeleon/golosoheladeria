import { supabase } from "@/integrations/supabase/client";

type RpcError = { message: string } | null;
type RpcResult<T> = { data: T | null; error: RpcError };
type RpcClient = {
  rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<RpcResult<T>>;
};

const rpcClient = supabase as unknown as RpcClient;

function throwIfError(error: RpcError) {
  if (error) throw new Error(error.message);
}

function firstRow<T>(value: T[] | T | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export type SupervisorAccount = {
  id: string;
  username: string;
  display_name: string;
  active: boolean;
  access_token: string;
  last_login_at: string | null;
  locked_until: string | null;
  created_at: string;
};

export type SupervisorSession = {
  session_token: string;
  expires_at: string;
  display_name: string;
  username: string;
};

export type SupervisorMovement = {
  id: string;
  kind: "expense" | "deposit";
  created_at: string;
  user_name: string | null;
  category: string | null;
  description: string | null;
  method: string | null;
  amount: number;
  status: string | null;
};

export type SupervisorDashboardData = {
  supervisor: { username: string; display_name: string };
  branches: Array<{ id: string; name: string; is_main: boolean }>;
  active_branch_id: string | null;
  generated_at: string;
  scope?: {
    kind: string;
    cash_session_id: string | null;
    start_at: string | null;
    end_at: string | null;
    timezone: string;
    date?: string;
  };
  summary: {
    total_sales: number;
    order_count: number;
    avg_ticket: number;
    cash_total: number;
    digital_total: number;
    expenses?: number;
    expenses_cash?: number;
    purchases?: number;
    deposits?: number;
    deposits_cash?: number;
    entries?: number;
    exits?: number;
    refunds?: number;
    tips?: number;
    cancelled_count?: number;
    cancelled_value?: number;
    opening_amount?: number;
    expected_cash?: number;
    net_balance?: number;
    tables_occupied: number;
    pending_llevar: number;
    pending_domicilio: number;
    preparing: number;
  };
  by_hour: Record<string, number>;
  by_service: Record<string, number>;
  by_payment: Record<string, number>;
  top_products: Array<{ name: string; qty: number; total?: number }>;
  low_products: Array<{ name: string; qty: number; total?: number }>;
  active_cash: {
    id: string;
    status: string | null;
    opened_at: string | null;
    closed_at: string | null;
    opening_amount: number | null;
    counted_amount?: number | null;
    expected_amount?: number | null;
    difference?: number | null;
    cash_counted?: number | null;
    nequi_counted?: number | null;
    bancolombia_counted?: number | null;
    cash_expected?: number | null;
    cash_expected_calc?: number | null;
    user_name: string | null;
    user_id: string | null;
    branch_id?: string | null;
  } | null;
  recent_closures?: Array<{
    id: string;
    status: string | null;
    opened_at: string | null;
    closed_at: string | null;
    opening_amount: number | null;
    counted_amount: number | null;
    expected_amount: number | null;
    difference: number | null;
    user_name: string | null;
    user_id: string | null;
    branch_id: string | null;
  }>;
  movements?: SupervisorMovement[];
};

export type SupervisorSessionDetail = {
  session: {
    id: string;
    branch_id: string;
    opened_at: string;
    closed_at: string | null;
    opening_amount: number | null;
    counted_amount: number | null;
    user_name: string | null;
    status: string | null;
  };
  branch_name: string | null;
  summary: {
    total_sales: number;
    order_count: number;
    avg_ticket: number;
    cancelled_count: number;
    cancelled_value: number;
    cash_total: number;
    expenses_total: number;
    expenses_cash: number;
    deposits_total: number;
    deposits_cash: number;
    opening_amount: number;
    expected_cash: number;
    counted_amount: number;
    difference: number;
  };
  payments: Record<string, { amount: number; count: number }>;
  services: Record<string, { amount: number; count: number }>;
  products: Array<{ name: string; qty: number; total: number }>;
  movements: SupervisorMovement[];
};

export async function listSupervisorAccounts(): Promise<SupervisorAccount[]> {
  const { data, error } = await rpcClient.rpc<SupervisorAccount[]>("list_supervisor_accounts_rpc");
  throwIfError(error);
  return data ?? [];
}

export async function createSupervisorAccount(data: { display_name: string; pin: string }) {
  const res = await rpcClient.rpc<Array<{ id: string; access_token: string; username: string }>>(
    "create_supervisor_account_rpc",
    { _display_name: data.display_name, _pin: data.pin },
  );
  throwIfError(res.error);
  const row = firstRow(res.data);
  if (!row) throw new Error("No se pudo crear el acceso supervisor");
  return row;
}

export async function updateSupervisorAccount(data: {
  id: string;
  display_name?: string;
  pin?: string;
  active?: boolean;
  regenerate_token?: boolean;
}) {
  const { error } = await rpcClient.rpc("update_supervisor_account_rpc", {
    _id: data.id,
    _display_name: data.display_name ?? null,
    _pin: data.pin ?? null,
    _active: data.active ?? null,
    _regenerate_token: data.regenerate_token ?? false,
  });
  throwIfError(error);
  return { ok: true };
}

export async function deleteSupervisorAccount(data: { id: string }) {
  const { error } = await rpcClient.rpc("delete_supervisor_account_rpc", { _id: data.id });
  throwIfError(error);
  return { ok: true };
}

export async function supervisorLogin(data: {
  token?: string;
  display_name?: string;
  username?: string;
  pin: string;
}): Promise<SupervisorSession> {
  const res = await rpcClient.rpc<SupervisorSession[] | SupervisorSession>("supervisor_login_rpc", {
    _token: data.token ?? null,
    _display_name: data.display_name ?? null,
    _username: data.username ?? null,
    _pin: data.pin,
    _user_agent: typeof navigator === "undefined" ? null : navigator.userAgent,
  });
  throwIfError(res.error);
  const row = firstRow(res.data);
  if (!row) throw new Error("No se pudo iniciar sesión");
  return row;
}

export async function supervisorLogout(data: { session_token: string }) {
  const { error } = await rpcClient.rpc("supervisor_logout_rpc", { _session_token: data.session_token });
  throwIfError(error);
  return { ok: true };
}

export async function supervisorDashboard(data: {
  session_token: string;
  branch_id?: string | null;
  log_switch?: boolean;
  date?: string | null; // YYYY-MM-DD in Bogota; null = today
}): Promise<SupervisorDashboardData> {
  const res = await rpcClient.rpc<SupervisorDashboardData>("supervisor_dashboard_rpc", {
    _session_token: data.session_token,
    _branch_id: data.branch_id ?? null,
    _log_switch: data.log_switch ?? false,
    _date: data.date ?? null,
  });
  throwIfError(res.error);
  if (!res.data) throw new Error("No se pudo cargar el tablero supervisor");
  return res.data;
}

export async function supervisorSessionDetail(data: {
  session_token: string;
  cash_session_id: string;
}): Promise<SupervisorSessionDetail> {
  const res = await rpcClient.rpc<SupervisorSessionDetail>("supervisor_session_detail_rpc", {
    _session_token: data.session_token,
    _cash_session_id: data.cash_session_id,
  });
  throwIfError(res.error);
  if (!res.data) throw new Error("No se pudo cargar el detalle del cierre");
  return res.data;
}

export async function listSupervisorAudit() {
  const { data, error } = await rpcClient.rpc("list_supervisor_audit_rpc");
  throwIfError(error);
  return data ?? [];
}