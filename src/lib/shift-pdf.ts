import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney } from "@/lib/format";
import type {
  CashSessionRow,
  ExpenseRow,
  SaleRow,
  SaleItemRow,
} from "@/lib/reports";
import {
  aggregateProducts,
  computeFinancialSummary,
  paymentBreakdown,
  serviceBreakdown,
} from "@/lib/reports";
import logoUrl from "@/assets/logo-goloso.webp";
import { supabase } from "@/integrations/supabase/client";

async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface ShiftPdfInput {
  session: CashSessionRow;
  branchName: string;
  turnNumber: number | string;
  sales: SaleRow[];
  items: SaleItemRow[];
  expenses: ExpenseRow[];
}

export async function downloadShiftPdf(input: ShiftPdfInput): Promise<void> {
  const { session, branchName, turnNumber, sales, items, expenses } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const logo = await loadLogo();

  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  if (logo) {
    try { doc.addImage(logo, "PNG", 40, 32, 56, 56); } catch { /* noop */ }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Cierre de Caja — Heladería Goloso", 110, 55);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Sede: ${branchName}`, 110, 75);
  doc.text(`Turno #${turnNumber}`, 110, 90);

  const openedAt = new Date(session.opened_at);
  const closedAt = session.closed_at ? new Date(session.closed_at) : null;
  const yTop = 110;
  doc.setFontSize(10);
  doc.text(
    `Apertura: ${session.user_name ?? "—"} · ${openedAt.toLocaleString()}`,
    40,
    yTop,
  );
  doc.text(
    `Cierre: ${session.user_name ?? "—"} · ${closedAt ? closedAt.toLocaleString() : "Turno abierto"}`,
    40,
    yTop + 14,
  );

  const summary = computeFinancialSummary(sales, expenses, [session]);
  const payments = paymentBreakdown(sales);
  const services = serviceBreakdown(sales);
  // Cargar catálogo de modificadores para excluirlos del listado de productos
  const { data: modRows } = await supabase.from("modifiers").select("name");
  const modifierNames = new Set(
    (modRows ?? [])
      .map((m: { name: string | null }) => (m.name ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const products = aggregateProducts(items, { modifierNames });

  // Resumen general
  autoTable(doc, {
    startY: yTop + 32,
    head: [["Resumen general", "Valor"]],
    body: [
      ["N° pedidos", String(summary.transactions)],
      ["Ventas totales", formatMoney(summary.salesTotal)],
      ["Ticket promedio", formatMoney(summary.averageTicket)],
      ["Propinas", formatMoney(summary.tips)],
      ["Pedidos cancelados", `${summary.cancelled} (${formatMoney(summary.cancelledValue)})`],
    ],
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235] },
  });

  // Medios de pago
  autoTable(doc, {
    head: [["Medio de pago", "Valor", "# transacciones"]],
    body: Object.entries(payments).map(([k, v]) => [
      k.toUpperCase(),
      formatMoney(v.amount),
      String(v.count),
    ]),
    theme: "grid",
    headStyles: { fillColor: [16, 185, 129] },
  });

  // Tipo de servicio
  autoTable(doc, {
    head: [["Tipo de servicio", "# pedidos", "Valor"]],
    body: Object.entries(services).map(([k, v]) => [k, String(v.count), formatMoney(v.amount)]),
    theme: "grid",
    headStyles: { fillColor: [217, 119, 6] },
  });

  // Balance efectivo
  const cashSalesRow = payments["efectivo"] ?? { amount: 0, count: 0 };
  const entriesAmt = summary.entries;
  const exitsAmt = summary.exits;
  const expensesAmt = summary.expenses;
  const refundsAmt = summary.refunds;
  const apertura = Number(session.opening_amount) || 0;
  const efectivoEsperado = apertura + cashSalesRow.amount + entriesAmt - exitsAmt - expensesAmt - refundsAmt;

  autoTable(doc, {
    head: [["Balance de efectivo", "Valor"]],
    body: [
      ["Apertura", formatMoney(apertura)],
      ["+ Ventas en efectivo", formatMoney(cashSalesRow.amount)],
      ["+ Entradas", formatMoney(entriesAmt)],
      ["− Salidas", formatMoney(exitsAmt)],
      ["− Gastos", formatMoney(expensesAmt)],
      ["− Devoluciones/Reembolsos", formatMoney(refundsAmt)],
      ["= Efectivo esperado", formatMoney(efectivoEsperado)],
    ],
    theme: "grid",
    headStyles: { fillColor: [124, 58, 237] },
  });

  // Productos
  const totalQty = products.reduce((a, p) => a + p.qty, 0);
  const totalProd = products.reduce((a, p) => a + p.total, 0);
  autoTable(doc, {
    head: [["Producto", "Cantidad", "Total"]],
    body: [
      ...products.map((p) => [p.name, String(p.qty), formatMoney(p.total)]),
      ["TOTAL", String(totalQty), formatMoney(totalProd)],
    ],
    theme: "striped",
    headStyles: { fillColor: [225, 29, 72] },
  });

  // Ajustes (entradas/salidas/gastos/devoluciones)
  autoTable(doc, {
    head: [["Fecha", "Usuario", "Categoría", "Descripción", "Valor"]],
    body: expenses.map((e) => [
      new Date(e.created_at).toLocaleString(),
      e.user_name ?? "—",
      e.category,
      e.description ?? "—",
      formatMoney(e.amount),
    ]),
    theme: "grid",
    headStyles: { fillColor: [71, 85, 105] },
  });

  // Comparación final
  const declared = Number(session.counted_amount) || 0;
  const expected = Number(session.expected_amount) || efectivoEsperado;
  const diff = declared - expected;
  autoTable(doc, {
    head: [["Comparación final", "Valor"]],
    body: [
      ["Valor esperado", formatMoney(expected)],
      ["Valor declarado", formatMoney(declared)],
      [
        "Diferencia",
        `${formatMoney(diff)} ${diff === 0 ? "(cuadró)" : diff > 0 ? "(sobrante)" : "(faltante)"}`,
      ],
    ],
    theme: "grid",
    headStyles: { fillColor: [15, 23, 42] },
  });

  // Footer
  const pageCount = (doc as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Heladería Goloso — Generado ${new Date().toLocaleString()} · Página ${i}/${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 20,
      { align: "center" },
    );
  }

  const fileName = `cierre-${branchName.replace(/\s+/g, "_")}-${turnNumber}.pdf`;
  doc.save(fileName);
}
