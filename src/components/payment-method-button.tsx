import { Banknote, Smartphone, Landmark, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

type PaymentKind = "cash" | "nequi" | "bancolombia" | "neutral";

function detectKind(name: string): PaymentKind {
  const n = name.toLowerCase();
  if (n.includes("efectivo") || n.includes("cash")) return "cash";
  if (n.includes("nequi")) return "nequi";
  if (n.includes("bancolombia")) return "bancolombia";
  return "neutral";
}

function IconFor({ kind }: { kind: PaymentKind }) {
  const cls = "h-4 w-4";
  if (kind === "cash") return <Banknote className={cls} />;
  if (kind === "nequi") return <Smartphone className={cls} />;
  if (kind === "bancolombia") return <Landmark className={cls} />;
  return <CreditCard className={cls} />;
}

interface PaymentMethodButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  methodName: string;
}

export function PaymentMethodButton({
  methodName,
  className,
  children,
  ...rest
}: PaymentMethodButtonProps) {
  const kind = detectKind(methodName);
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "pay-btn",
        kind === "cash" && "pay-btn-cash",
        kind === "nequi" && "pay-btn-nequi",
        kind === "bancolombia" && "pay-btn-bancolombia",
        kind === "neutral" && "pay-btn-neutral",
        className,
      )}
    >
      <span className="pay-btn-icon">
        <IconFor kind={kind} />
      </span>
      <span>{children ?? methodName}</span>
    </button>
  );
}
