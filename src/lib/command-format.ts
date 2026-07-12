// Formatos de comanda editables desde Ajustes → Impresoras → Comandas.
// Este archivo es compartido entre el editor (UI + preview) y el cliente
// de impresión, que inyecta el formato activo en el payload de cada comanda.

export type CommandFormat = {
  label: string;
  font: "A" | "B";
  titleSize: 1 | 2 | 3 | 4;
  productSize: 1 | 2 | 3 | 4;
  modifierSize: 1 | 2 | 3 | 4;
  bold: { title: boolean; product: boolean; modifier: boolean };
  align: {
    header: "left" | "center" | "right";
    product: "left" | "center" | "right";
    orderType: "left" | "center" | "right";
  };
  separator: { char: "-" | "=" | "*" | "." | " "; blankLines: 0 | 1 | 2 };
  lineSpacing: 0 | 1 | 2 | 3;
  margins: { left: 0 | 1 | 2 | 3 | 4; right: 0 | 1 | 2 | 3 | 4 };
  modifiersLayout: "inline" | "list";
  quantityFormat: "x" | "times" | "paren";
  orderNumberFormat: "hash" | "pedido" | "ticket";
  tableFormat: "MESA N" | "Mesa: N" | "MN";
  orderTypeFormat: "prefix" | "arrow" | "hidden";
};

export type CommandFormatsMap = Record<string, CommandFormat>;

export const DEFAULT_FORMATS: CommandFormatsMap = {
  clasico: {
    label: "Clásico",
    font: "A",
    titleSize: 2, productSize: 1, modifierSize: 2,
    bold: { title: true, product: true, modifier: true },
    align: { header: "center", product: "left", orderType: "center" },
    separator: { char: "-", blankLines: 0 },
    lineSpacing: 0,
    margins: { left: 0, right: 0 },
    modifiersLayout: "list",
    quantityFormat: "x",
    orderNumberFormat: "hash",
    tableFormat: "MESA N",
    orderTypeFormat: "prefix",
  },
  compacto: {
    label: "Compacto",
    font: "B",
    titleSize: 1, productSize: 1, modifierSize: 2,
    bold: { title: true, product: true, modifier: true },
    align: { header: "left", product: "left", orderType: "left" },
    separator: { char: "-", blankLines: 0 },
    lineSpacing: 0,
    margins: { left: 0, right: 0 },
    modifiersLayout: "list",
    quantityFormat: "x",
    orderNumberFormat: "hash",
    tableFormat: "MN",
    orderTypeFormat: "prefix",
  },
  grande: {
    label: "Grande / Legible",
    font: "A",
    titleSize: 3, productSize: 2, modifierSize: 2,
    bold: { title: true, product: true, modifier: true },
    align: { header: "center", product: "left", orderType: "center" },
    separator: { char: "=", blankLines: 1 },
    lineSpacing: 1,
    margins: { left: 1, right: 1 },
    modifiersLayout: "list",
    quantityFormat: "times",
    orderNumberFormat: "pedido",
    tableFormat: "MESA N",
    orderTypeFormat: "arrow",
  },
};

/** Rellena huecos con los valores del preset "clasico" para tolerar formatos
 *  parcialmente guardados (compatibilidad hacia adelante). */
export function normalizeFormat(f: Partial<CommandFormat> | null | undefined): CommandFormat {
  const base = DEFAULT_FORMATS.clasico;
  const src = (f ?? {}) as Partial<CommandFormat>;
  return {
    label: src.label ?? base.label,
    font: src.font ?? base.font,
    titleSize: (src.titleSize ?? base.titleSize) as CommandFormat["titleSize"],
    productSize: (src.productSize ?? base.productSize) as CommandFormat["productSize"],
    modifierSize: Math.max(2, Number(src.modifierSize ?? base.modifierSize) || 2) as CommandFormat["modifierSize"],
    bold: { ...base.bold, ...(src.bold ?? {}), modifier: true },
    align: { ...base.align, ...(src.align ?? {}) },
    separator: { ...base.separator, ...(src.separator ?? {}) },
    lineSpacing: (src.lineSpacing ?? base.lineSpacing) as CommandFormat["lineSpacing"],
    margins: { ...base.margins, ...(src.margins ?? {}) },
    modifiersLayout: "list",
    quantityFormat: src.quantityFormat ?? base.quantityFormat,
    orderNumberFormat: src.orderNumberFormat ?? base.orderNumberFormat,
    tableFormat: src.tableFormat ?? base.tableFormat,
    orderTypeFormat: src.orderTypeFormat ?? base.orderTypeFormat,
  };
}

export function formatQuantity(qty: number, fmt: CommandFormat["quantityFormat"]): string {
  const n = Math.max(0, Number(qty || 0));
  if (fmt === "times") return `${n}×`;
  if (fmt === "paren") return `(${n})`;
  return `${n}x`;
}

export function formatOrderNumber(num: string | number | null | undefined, fmt: CommandFormat["orderNumberFormat"]): string {
  const s = String(num ?? "").trim().replace(/^#+\s*/, "");
  if (!s) return "";
  if (fmt === "pedido") return `PEDIDO # ${s}`;
  if (fmt === "ticket") return `TICKET # ${s}`;
  return `# ${s}`;
}

export function formatTable(num: string | number | null | undefined, fmt: CommandFormat["tableFormat"]): string {
  const s = String(num ?? "").trim().replace(/^mesa\s*#?\s*/i, "");
  if (!s) return "";
  if (fmt === "Mesa: N") return `Mesa: # ${s}`;
  if (fmt === "MN") return `M# ${s}`;
  return `MESA # ${s}`;
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  mesa: "",
  llevar: "PARA LLEVAR",
  domicilio: "A DOMICILIO",
  kiosko: "AUTOPEDIDO",
  online: "EN LINEA",
};

function normalizeOrderTypeKey(type: string | null | undefined): string {
  const key = String(type || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!key) return "";
  if (key.includes("autopedido") || key.includes("quiosco") || key.includes("kiosko") || key === "kiosk") return "kiosko";
  if (key.includes("domicilio") || key.includes("delivery")) return "domicilio";
  if (key.includes("llevar")) return "llevar";
  if (key.includes("mesa")) return "mesa";
  if (key.includes("linea") || key.includes("online")) return "online";
  return key;
}

export function formatOrderType(type: string | null | undefined, fmt: CommandFormat["orderTypeFormat"]): string {
  if (fmt === "hidden") return "";
  const key = normalizeOrderTypeKey(type);
  const base = ORDER_TYPE_LABELS[key] || (key ? key.toUpperCase() : "");
  if (!base) return "";
  if (key === "kiosko") return base;
  if (fmt === "arrow") return `>> ${base}`;
  return `PEDIDO ${base}`;
}

/** Renderiza una comanda de ejemplo como texto monoespaciado para la vista
 *  previa en el editor. El Print Server aplica las mismas reglas al imprimir. */
export function renderPreview(fmt: CommandFormat, opts: { width?: number } = {}): string {
  const WIDTH = opts.width ?? 42;
  const marginL = " ".repeat(fmt.margins.left);
  const usable = Math.max(10, WIDTH - fmt.margins.left - fmt.margins.right);
  const align = (text: string, mode: "left" | "center" | "right"): string => {
    const t = text.length > usable ? text.slice(0, usable) : text;
    if (mode === "center") {
      const pad = Math.max(0, Math.floor((usable - t.length) / 2));
      return marginL + " ".repeat(pad) + t;
    }
    if (mode === "right") {
      const pad = Math.max(0, usable - t.length);
      return marginL + " ".repeat(pad) + t;
    }
    return marginL + t;
  };
  const sep = fmt.separator.char === " "
    ? ""
    : align(fmt.separator.char.repeat(usable), "left");
  const gap = "\n".repeat(fmt.lineSpacing);
  const bold = (t: string, on: boolean) => (on ? `**${t}**` : t);
  const big = (t: string, size: number) =>
    size >= 3 ? t.toUpperCase() : size === 2 ? t.toUpperCase() : t;

  const lines: string[] = [];
  lines.push(align(bold(big("** SEDE CENTRO **", fmt.titleSize), fmt.bold.title), fmt.align.header));
  lines.push(align(bold(formatOrderNumber(1234, fmt.orderNumberFormat), fmt.bold.title), fmt.align.header));
  lines.push(align("CAJERO 7B9", "center"));
  lines.push(align("10:47 PM  06-07-2026", "center"));
  const ot = formatOrderType("mesa", fmt.orderTypeFormat);
  if (ot) lines.push(align(bold(ot, fmt.bold.title), fmt.align.orderType));
  lines.push(align(bold(formatTable(4, fmt.tableFormat), fmt.bold.title), fmt.align.header));
  if (sep) lines.push(sep);
  for (let i = 0; i < fmt.separator.blankLines; i++) lines.push("");

  const items = [
    { qty: 2, name: "Copa Goloso Especial", mods: ["Chocolate", "Fresa", "Extra crema"] },
    { qty: 1, name: "Malteada de Fresa",   mods: [] as string[] },
  ];
  for (const it of items) {
    const prodLine = `${formatQuantity(it.qty, fmt.quantityFormat)} ${big(it.name.toUpperCase(), fmt.productSize)}`;
    lines.push(align(bold(prodLine, fmt.bold.product), fmt.align.product));
    if (gap) lines.push(gap);
    if (it.mods.length) {
      if (fmt.modifiersLayout === "inline") {
        const joined = "+ " + it.mods.join(" + ");
        lines.push(align(bold(joined, fmt.bold.modifier), fmt.align.product).replace(marginL, marginL + "  "));
      } else {
        for (const m of it.mods) {
          lines.push(align(bold(`+ ${m}`, fmt.bold.modifier), fmt.align.product).replace(marginL, marginL + "  "));
        }
      }
    }
    if (sep) lines.push(sep);
  }
  lines.push(align(bold("OBSERVACION:", true), "left") + " Sin azúcar");
  return lines.join("\n");
}
