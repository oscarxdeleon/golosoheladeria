import { Check, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";

type Denom = {
  value: number;
  label: string;
  gradient: string;
  ring: string;
  seal: string;
  text: string;
};

const DENOMS: Denom[] = [
  {
    value: 2000,
    label: "2",
    gradient: "linear-gradient(120deg, #eaf3fb 0%, #cfe4f3 45%, #8fbde0 100%)",
    ring: "#4f8fbe",
    seal: "#1e4d75",
    text: "#123957",
  },
  {
    value: 5000,
    label: "5",
    gradient: "linear-gradient(120deg, #fff2e2 0%, #f8d1a4 55%, #d78a4a 100%)",
    ring: "#c2743a",
    seal: "#7a3d15",
    text: "#5a2d10",
  },
  {
    value: 10000,
    label: "10",
    gradient: "linear-gradient(120deg, #ffe6e6 0%, #f5b5b5 55%, #d76464 100%)",
    ring: "#c05353",
    seal: "#7a1e1e",
    text: "#611515",
  },
  {
    value: 20000,
    label: "20",
    gradient: "linear-gradient(120deg, #fff2d6 0%, #f5c987 55%, #d78a2e 100%)",
    ring: "#c1782a",
    seal: "#7a4110",
    text: "#5c320c",
  },
  {
    value: 50000,
    label: "50",
    gradient: "linear-gradient(120deg, #eee6f7 0%, #c4aee0 55%, #8a68b8 100%)",
    ring: "#7a58a8",
    seal: "#3f2669",
    text: "#2f1c50",
  },
  {
    value: 100000,
    label: "100",
    gradient: "linear-gradient(120deg, #e5f5ec 0%, #a9dabf 55%, #4fa87a 100%)",
    ring: "#3f8a63",
    seal: "#1f5e3d",
    text: "#164a2f",
  },
];

interface CashPayPadProps {
  total: number;
  cashReceived: string;
  onSetReceived: (v: string) => void;
  onFocusInput?: () => void;
  disabled?: boolean;
}

export function CashPayPad({
  total,
  cashReceived,
  onSetReceived,
  onFocusInput,
  disabled,
}: CashPayPadProps) {
  const addValue = (v: number) => {
    const next = (Number(cashReceived) || 0) + v;
    onSetReceived(String(next));
  };
  const setExact = () => onSetReceived(String(total));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* DIGITE VALOR $ */}
      <button
        type="button"
        disabled={disabled}
        onClick={onFocusInput}
        className="cash-tile cash-tile--white"
        aria-label="Digitar valor"
      >
        <span className="cash-tile__stack">
          <span className="cash-tile__title">DIGITE</span>
          <span className="cash-tile__title">
            VALOR <DollarSign className="inline h-4 w-4 -mt-1" strokeWidth={3} />
          </span>
        </span>
      </button>

      {/* EXACTO */}
      <button
        type="button"
        disabled={disabled}
        onClick={setExact}
        className="cash-tile cash-tile--exact"
        aria-label="Pago exacto"
      >
        <span className="cash-tile__stack items-center">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-inner">
            <Check className="h-5 w-5 text-emerald-700" strokeWidth={3.5} />
          </span>
          <span className="cash-tile__title text-white mt-1">EXACTO</span>
        </span>
      </button>

      {/* Denominaciones */}
      {DENOMS.map((d) => (
        <button
          key={d.value}
          type="button"
          disabled={disabled}
          onClick={() => addValue(d.value)}
          className={cn("cash-tile cash-tile--bill group")}
          style={{
            background: d.gradient,
            borderColor: d.ring,
            color: d.text,
          }}
          aria-label={`Sumar ${formatMoney(d.value)}`}
        >
          <div className="flex w-full items-start justify-between gap-2">
            <div className="flex flex-col leading-none">
              <span className="text-2xl font-black tracking-tight" style={{ color: d.text }}>
                {d.label}
              </span>
              <span
                className="text-[9px] font-bold tracking-wider mt-0.5"
                style={{ color: d.text }}
              >
                MIL
                <br />
                PESOS
              </span>
            </div>
            <div
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[10px] font-black"
              style={{ background: "rgba(255,255,255,0.55)", color: d.seal }}
            >
              {d.label}
            </div>
          </div>
          <div className="mt-auto w-full pt-2 text-right">
            <span
              className="inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest"
              style={{ background: "rgba(255,255,255,0.6)", color: d.seal }}
            >
              Colombia
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
