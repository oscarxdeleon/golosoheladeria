import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/format";

interface Category {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  online_sort_order: number;
  kiosk_sort_order: number;
  show_in_online_menu: boolean;
  show_in_pos: boolean;
  color: string | null;
}

interface Product {
  id: string;
  name: string;
  price: number;
  category_id: string | null;
  sku: string | null;
  active: boolean;
  image_url: string | null;
  show_in_online: boolean;
  is_favorite: boolean;
  sold_by_weight: boolean;
  track_stock: boolean;
  stock: number;
  min_stock: number;
  allow_negative_stock: boolean;
  available_branch_ids: string[] | null;
  modifier_group_ids: string[] | null;
  recipe: unknown;
  source_product_id: string | null;
  is_linked: boolean;
}

interface ModifierGroup {
  id: string;
  name: string;
  branch_id: string;
  min_select: number;
  max_select: number;
  required: boolean;
}

interface Modifier {
  id: string;
  group_id: string;
  name: string;
  price: number;
  active: boolean;
  branch_id: string;
  disabled_branch_ids: string[];
}

interface Branch { id: string; name: string; }
interface Supply { id: string; name: string; unit: string | null; }

async function fetchAll() {
  const [cats, prods, groups, mods, branches, supplies] = await Promise.all([
    supabase.from("categories").select("*").order("sort_order"),
    supabase.from("products").select("*").order("name"),
    supabase.from("modifier_groups").select("*").order("name"),
    supabase.from("modifiers").select("*").order("name"),
    supabase.from("branches").select("id,name"),
    supabase.from("supplies").select("id,name,unit"),
  ]);
  return {
    categories: (cats.data ?? []) as Category[],
    products: (prods.data ?? []) as Product[],
    groups: (groups.data ?? []) as ModifierGroup[],
    modifiers: (mods.data ?? []) as Modifier[],
    branches: (branches.data ?? []) as Branch[],
    supplies: (supplies.data ?? []) as Supply[],
  };
}

function branchNames(ids: string[] | null, branches: Branch[]) {
  if (!ids || ids.length === 0) return "Todas";
  const map = new Map(branches.map((b) => [b.id, b.name]));
  return ids.map((id) => map.get(id) ?? id).join(", ");
}

function recipeText(recipe: unknown, supplies: Supply[]) {
  if (!Array.isArray(recipe) || recipe.length === 0) return "";
  const map = new Map(supplies.map((s) => [s.id, s]));
  return recipe
    .map((r) => {
      const rr = r as { supply_id?: string; qty?: number };
      const s = rr.supply_id ? map.get(rr.supply_id) : null;
      const name = s?.name ?? rr.supply_id ?? "?";
      const unit = s?.unit ? ` ${s.unit}` : "";
      return `${name}: ${rr.qty ?? 0}${unit}`;
    })
    .join(" | ");
}

export async function exportMenuExcel() {
  const data = await fetchAll();
  const catMap = new Map(data.categories.map((c) => [c.id, c.name]));
  const groupMap = new Map(data.groups.map((g) => [g.id, g]));
  const branchMap = new Map(data.branches.map((b) => [b.id, b.name]));

  const wb = XLSX.utils.book_new();

  // Categorías
  const catRows = data.categories.map((c) => ({
    Nombre: c.name,
    Activa: c.active ? "Sí" : "No",
    "Orden POS": c.sort_order,
    "Orden Online": c.online_sort_order,
    "Orden Quiosco": c.kiosk_sort_order,
    "Mostrar en POS": c.show_in_pos ? "Sí" : "No",
    "Mostrar en Menú Online": c.show_in_online_menu ? "Sí" : "No",
    Color: c.color ?? "",
    ID: c.id,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows), "Categorías");

  // Productos
  const prodRows = data.products.map((p) => {
    const groupNames = (p.modifier_group_ids ?? [])
      .map((gid) => groupMap.get(gid)?.name ?? gid)
      .join(", ");
    return {
      Nombre: p.name,
      Categoría: p.category_id ? catMap.get(p.category_id) ?? "" : "",
      Precio: p.price,
      "Precio formateado": formatMoney(Number(p.price) || 0),
      SKU: p.sku ?? "",
      Activo: p.active ? "Sí" : "No",
      Favorito: p.is_favorite ? "Sí" : "No",
      "Vendido por peso": p.sold_by_weight ? "Sí" : "No",
      "Mostrar en menú online": p.show_in_online ? "Sí" : "No",
      "Controla stock": p.track_stock ? "Sí" : "No",
      Stock: p.stock,
      "Stock mínimo": p.min_stock,
      "Permite stock negativo": p.allow_negative_stock ? "Sí" : "No",
      "Sedes disponibles": branchNames(p.available_branch_ids, data.branches),
      "Grupos de modificadores": groupNames,
      Receta: recipeText(p.recipe, data.supplies),
      "URL imagen": p.image_url ?? "",
      Vinculado: p.is_linked ? "Sí" : "No",
      "Producto origen (ID)": p.source_product_id ?? "",
      ID: p.id,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows), "Productos");

  // Modificadores (grupos)
  const groupRows = data.groups.map((g) => {
    const opts = data.modifiers.filter((m) => m.group_id === g.id);
    // Cuántos productos lo usan
    const usedBy = data.products.filter((p) => (p.modifier_group_ids ?? []).includes(g.id));
    return {
      "Nombre del grupo": g.name,
      Sede: branchMap.get(g.branch_id) ?? g.branch_id,
      Obligatorio: g.required ? "Sí" : "No",
      "Selección mínima": g.min_select,
      "Selección máxima": g.max_select,
      "Permite múltiple": g.max_select > 1 ? "Sí" : "No",
      "Nº de opciones": opts.length,
      "Productos que lo usan": usedBy.map((p) => p.name).join(", "),
      ID: g.id,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(groupRows), "Modificadores");

  // Opciones de modificadores
  const optRows = data.modifiers.map((m) => {
    const g = groupMap.get(m.group_id);
    return {
      Grupo: g?.name ?? "",
      Opción: m.name,
      "Precio adicional": m.price,
      "Precio formateado": formatMoney(Number(m.price) || 0),
      Activa: m.active ? "Sí" : "No",
      Sede: branchMap.get(m.branch_id) ?? m.branch_id,
      "Deshabilitada en sedes": (m.disabled_branch_ids ?? [])
        .map((id) => branchMap.get(id) ?? id)
        .join(", "),
      "ID grupo": m.group_id,
      ID: m.id,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(optRows), "Opciones");

  // Variantes: en este esquema las variantes/tamaños se modelan como grupos de modificadores
  // (ej: "Tamaño", "Presentación"). Se listan aquí filtrados por nombre común.
  const variantKeywords = /tama|talla|presen|porc|cantidad|vers/i;
  const variantGroups = data.groups.filter((g) => variantKeywords.test(g.name));
  const variantRows: Array<Record<string, unknown>> = [];
  for (const g of variantGroups) {
    const opts = data.modifiers.filter((m) => m.group_id === g.id);
    for (const o of opts) {
      variantRows.push({
        "Grupo (variante)": g.name,
        Sede: branchMap.get(g.branch_id) ?? g.branch_id,
        Opción: o.name,
        "Precio adicional": o.price,
        "Precio formateado": formatMoney(Number(o.price) || 0),
        Obligatorio: g.required ? "Sí" : "No",
        "Selección mín/máx": `${g.min_select}/${g.max_select}`,
      });
    }
  }
  if (variantRows.length === 0) {
    variantRows.push({
      Nota: "No se detectaron grupos de modificadores usados como variantes (Tamaño, Presentación, Cantidad, Versión).",
    });
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(variantRows), "Variantes");

  // Información adicional (resumen)
  const summary = [
    { Item: "Categorías totales", Valor: data.categories.length },
    { Item: "Categorías activas", Valor: data.categories.filter((c) => c.active).length },
    { Item: "Productos totales", Valor: data.products.length },
    { Item: "Productos activos", Valor: data.products.filter((p) => p.active).length },
    { Item: "Productos en menú online", Valor: data.products.filter((p) => p.show_in_online).length },
    { Item: "Grupos de modificadores", Valor: data.groups.length },
    { Item: "Opciones de modificadores", Valor: data.modifiers.length },
    { Item: "Sedes", Valor: data.branches.length },
    { Item: "Insumos registrados", Valor: data.supplies.length },
    { Item: "Fecha de exportación", Valor: new Date().toLocaleString("es-CO") },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Información");

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `menu-goloso-${stamp}.xlsx`);
}

export async function exportMenuPdf() {
  const data = await fetchAll();
  const catMap = new Map(data.categories.map((c) => [c.id, c]));
  const groupMap = new Map(data.groups.map((g) => [g.id, g]));
  const branchMap = new Map(data.branches.map((b) => [b.id, b.name]));

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(18);
  doc.text("Menú Completo · Heladería Goloso", pageWidth / 2, 40, { align: "center" });
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(
    `Exportado ${new Date().toLocaleString("es-CO")} · ${data.products.length} productos · ${data.categories.length} categorías`,
    pageWidth / 2,
    58,
    { align: "center" },
  );
  doc.setTextColor(0);

  let cursorY = 80;

  // Agrupar productos por categoría
  const byCat = new Map<string, Product[]>();
  const noCat: Product[] = [];
  for (const p of data.products) {
    if (!p.category_id) noCat.push(p);
    else {
      const arr = byCat.get(p.category_id) ?? [];
      arr.push(p);
      byCat.set(p.category_id, arr);
    }
  }

  const orderedCats = [...data.categories].sort((a, b) => a.sort_order - b.sort_order);

  for (const cat of orderedCats) {
    const items = byCat.get(cat.id) ?? [];
    if (items.length === 0) continue;

    if (cursorY > 720) { doc.addPage(); cursorY = 40; }
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`${cat.name}${cat.active ? "" : " (inactiva)"}`, 40, cursorY);
    cursorY += 6;

    autoTable(doc, {
      startY: cursorY + 6,
      head: [["Producto", "Precio", "SKU", "Estado", "Online", "Modificadores"]],
      body: items.map((p) => [
        p.name,
        formatMoney(Number(p.price) || 0),
        p.sku ?? "",
        p.active ? "Activo" : "Inactivo",
        p.show_in_online ? "Sí" : "No",
        (p.modifier_group_ids ?? [])
          .map((gid) => groupMap.get(gid)?.name ?? "")
          .filter(Boolean)
          .join(", ") || "—",
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [219, 39, 119] },
      margin: { left: 40, right: 40 },
    });
    // @ts-expect-error autotable adds lastAutoTable
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 20;
  }

  if (noCat.length > 0) {
    if (cursorY > 720) { doc.addPage(); cursorY = 40; }
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("Sin categoría", 40, cursorY);
    autoTable(doc, {
      startY: cursorY + 6,
      head: [["Producto", "Precio", "SKU", "Estado"]],
      body: noCat.map((p) => [
        p.name, formatMoney(Number(p.price) || 0), p.sku ?? "", p.active ? "Activo" : "Inactivo",
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [107, 114, 128] },
      margin: { left: 40, right: 40 },
    });
    // @ts-expect-error autotable
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 20;
  }

  // Sección de modificadores
  doc.addPage();
  cursorY = 40;
  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("Modificadores y opciones", 40, cursorY);
  cursorY += 20;

  for (const g of data.groups) {
    const opts = data.modifiers.filter((m) => m.group_id === g.id);
    if (opts.length === 0) continue;
    if (cursorY > 720) { doc.addPage(); cursorY = 40; }

    doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.text(
      `${g.name} · ${branchMap.get(g.branch_id) ?? ""} · ${g.required ? "Obligatorio" : "Opcional"} (${g.min_select}-${g.max_select})`,
      40,
      cursorY,
    );

    autoTable(doc, {
      startY: cursorY + 4,
      head: [["Opción", "Precio adicional", "Activa"]],
      body: opts.map((o) => [
        o.name,
        Number(o.price) ? formatMoney(Number(o.price)) : "—",
        o.active ? "Sí" : "No",
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [59, 130, 246] },
      margin: { left: 40, right: 40 },
    });
    // @ts-expect-error autotable
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 14;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`menu-goloso-${stamp}.pdf`);
  // touch catMap so lint doesn't complain (kept for future column expansions)
  void catMap;
}
