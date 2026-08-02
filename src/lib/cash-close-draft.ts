/**
 * Borrador local del cierre de caja.
 *
 * Guarda automáticamente lo que el cajero va digitando (monedas, billetes,
 * Nequi, Bancolombia, notas) para que nunca se pierda si sale de la pantalla,
 * cambia de módulo o el cierre queda bloqueado por pedidos pendientes.
 *
 * El borrador se guarda por SEDE + SESIÓN de caja, así que es compatible con
 * todas las sedes y usuarios, y se elimina únicamente cuando el cierre se
 * realiza con éxito.
 */

export interface CashCloseDraft {
  coinQty: Record<string, string>;
  billQty: Record<string, string>;
  nequiCounted: string;
  bancoCounted: string;
  closingNotes: string;
  savedAt: number;
}

const PREFIX = "goloso:cash-close-draft:";
// Un borrador viejo (sesión abandonada) no debería restaurarse eternamente.
const MAX_AGE_MS = 1000 * 60 * 60 * 48;

export function draftKey(branchId: string, sessionId: string) {
  return `${PREFIX}${branchId}:${sessionId}`;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCashCloseDraft(branchId: string, sessionId: string): CashCloseDraft | null {
  const store = safeStorage();
  if (!store || !branchId || !sessionId) return null;
  try {
    const raw = store.getItem(draftKey(branchId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CashCloseDraft>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > MAX_AGE_MS) {
      store.removeItem(draftKey(branchId, sessionId));
      return null;
    }
    return {
      coinQty: (parsed.coinQty ?? {}) as Record<string, string>,
      billQty: (parsed.billQty ?? {}) as Record<string, string>,
      nequiCounted: parsed.nequiCounted ?? "",
      bancoCounted: parsed.bancoCounted ?? "",
      closingNotes: parsed.closingNotes ?? "",
      savedAt: parsed.savedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveCashCloseDraft(
  branchId: string,
  sessionId: string,
  draft: Omit<CashCloseDraft, "savedAt">,
) {
  const store = safeStorage();
  if (!store || !branchId || !sessionId) return;
  try {
    store.setItem(
      draftKey(branchId, sessionId),
      JSON.stringify({ ...draft, savedAt: Date.now() } satisfies CashCloseDraft),
    );
  } catch {
    /* cuota llena o modo privado: el cierre debe seguir funcionando */
  }
}

export function clearCashCloseDraft(branchId: string, sessionId: string) {
  const store = safeStorage();
  if (!store) return;
  try {
    store.removeItem(draftKey(branchId, sessionId));
  } catch {
    /* noop */
  }
}

export function isDraftEmpty(draft: Omit<CashCloseDraft, "savedAt">): boolean {
  const anyQty = (r: Record<string, string>) =>
    Object.values(r ?? {}).some((v) => (v ?? "").replace(/\D/g, "") !== "");
  return (
    !anyQty(draft.coinQty) &&
    !anyQty(draft.billQty) &&
    !draft.nequiCounted &&
    !draft.bancoCounted &&
    !draft.closingNotes
  );
}
