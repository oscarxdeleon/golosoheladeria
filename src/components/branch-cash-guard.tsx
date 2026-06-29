import { type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranchCashSession } from "@/hooks/use-branch-cash-session";
import { useBranch } from "@/contexts/branch-context";

interface Props {
  children: ReactNode;
  /** Si true, muestra botón para cerrar sesión (modo tablet de meseros). */
  allowLogout?: boolean;
  /** Mensaje extra mostrado debajo del título. */
  extraMessage?: string;
}

/**
 * Bloquea la interfaz cuando NO hay caja abierta en la sede activa.
 * Pensado para meseros / tablets de pedidos: ningún pedido puede
 * registrarse si la Caja Principal de la sede no fue abierta primero.
 */
export function BranchCashGuard({ children, allowLogout, extraMessage }: Props) {
  const { activeBranchId, activeBranch } = useBranch();
  const { isOpen, loading } = useBranchCashSession(activeBranchId);

  const showBlock = !!activeBranchId && !loading && !isOpen;

  return (
    <>
      {children}
      <Dialog open={showBlock}>
        <DialogContent
          className="max-w-md border-amber-300"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Lock className="h-7 w-7" />
            </div>
            <DialogTitle className="text-center text-xl">Caja cerrada</DialogTitle>
            <DialogDescription className="text-center text-base leading-relaxed">
              <strong>Atención:</strong> No es posible tomar pedidos. Primero se debe realizar la
              Apertura de Caja en el POS Principal de la sede.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 text-center text-sm">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              Sede:&nbsp;<span className="font-semibold text-foreground">{activeBranch?.name ?? "—"}</span>
            </div>
            {extraMessage ? (
              <p className="mt-2 text-xs text-muted-foreground">{extraMessage}</p>
            ) : null}
          </div>
          {allowLogout ? (
            <Button
              variant="outline"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/auth";
              }}
            >
              Cerrar sesión
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
