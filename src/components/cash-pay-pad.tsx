import { cn } from "@/lib/utils";
import exactoImg from "@/assets/bills/exacto.png";
import b2Img from "@/assets/bills/b2.png";
import b5Img from "@/assets/bills/b5.png";
import b10Img from "@/assets/bills/b10.png";
import b20Img from "@/assets/bills/b20.png";
import b50Img from "@/assets/bills/b50.png";
import b100Img from "@/assets/bills/b100.png";

type Tile =
  | { kind: "exacto"; img: string; alt: string }
  | { kind: "bill"; value: number; img: string; alt: string };

const ROW1: Tile[] = [
  { kind: "exacto", img: exactoImg, alt: "Pago exacto" },
  { kind: "bill", value: 2000, img: b2Img, alt: "Sumar 2.000" },
  { kind: "bill", value: 5000, img: b5Img, alt: "Sumar 5.000" },
];
const ROW2: Tile[] = [
  { kind: "bill", value: 10000, img: b10Img, alt: "Sumar 10.000" },
  { kind: "bill", value: 20000, img: b20Img, alt: "Sumar 20.000" },
  { kind: "bill", value: 50000, img: b50Img, alt: "Sumar 50.000" },
  { kind: "bill", value: 100000, img: b100Img, alt: "Sumar 100.000" },
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
  disabled,
}: CashPayPadProps) {
  const addValue = (v: number) => {
    const next = (Number(cashReceived) || 0) + v;
    onSetReceived(String(next));
  };
  const setExact = () => onSetReceived(String(total));

  const renderTile = (t: Tile) => {
    const onClick = t.kind === "exacto" ? setExact : () => addValue(t.value);
    return (
      <button
        key={t.kind === "exacto" ? "exacto" : t.value}
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={t.alt}
        className={cn(
          "group relative block w-full overflow-visible rounded-2xl",
          "transition-transform duration-150 ease-out",
          "hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0",
        )}
      >
        <img
          src={t.img}
          alt={t.alt}
          draggable={false}
          className="pointer-events-none block h-auto w-full select-none drop-shadow-[0_6px_14px_rgba(0,0,0,0.18)] transition-[filter] duration-150 group-hover:drop-shadow-[0_10px_20px_rgba(0,0,0,0.22)]"
        />
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">{ROW1.map(renderTile)}</div>
      <div className="grid grid-cols-4 gap-3">{ROW2.map(renderTile)}</div>
    </div>
  );
}
