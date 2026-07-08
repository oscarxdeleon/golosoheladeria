import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, Star, Copy, FileSpreadsheet, Download, FileText, Loader2, Camera, Link2, Link2Off, RefreshCw, CopyPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import * as XLSX from "xlsx";
import { useServerFn } from "@tanstack/react-start";
import { parseMenuPdfText } from "@/lib/menu-pdf.functions";
import { ImageDropzone } from "@/components/image-dropzone";


import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/menu/productos")({
  head: () => ({ meta: [{ title: "Productos · Goloso POS" }] }),
  component: ProductosPage,
});

interface RecipeItem { supply_id: string; qty: number; }
interface Product {
  id: string;
  name: string;
  price: number;
  category_id: string | null;
  sku: string | null;
  active: boolean;
  image_url: string | null;
  allow_negative_stock?: boolean;
  sold_by_weight?: boolean;
  show_in_online?: boolean;
  is_favorite?: boolean;
  available_branch_ids?: string[] | null;
  modifier_group_ids?: string[] | null;
  recipe?: RecipeItem[] | null;
  source_product_id?: string | null;
  is_linked?: boolean;
}

interface Category { id: string; name: string; }
interface Branch { id: string; name: string; is_main: boolean; }
interface ModifierGroup { id: string; name: string; }
interface Supply { id: string; name: string; unit: string; }

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium leading-tight">{label}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ProductosPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [showRecipe, setShowRecipe] = useState(false);
  const [showMods, setShowMods] = useState(false);

  // Safety cleanup: al cerrar el diálogo de edición aseguramos que Radix no
  // deje el <body> con pointer-events/overflow bloqueados (evita pantalla en blanco).
  useEffect(() => {
    if (editing === null && typeof document !== "undefined") {
      const t = setTimeout(() => {
        document.body.style.pointerEvents = "";
        document.body.style.overflow = "";
        document.body.removeAttribute("data-scroll-locked");
      }, 300);
      return () => clearTimeout(t);
    }
  }, [editing]);

  const [duplicating, setDuplicating] = useState<Product | null>(null);
  const [dupName, setDupName] = useState("");
  const [dupMain, setDupMain] = useState(true);
  const [dupBranch, setDupBranch] = useState(true);
  const [dupCopyModsRecipe, setDupCopyModsRecipe] = useState(true);
  const [dupSaving, setDupSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  // Al crear nuevo producto: opción para replicarlo como copias INDEPENDIENTES en las sucursales.
  const [createInAllBranches, setCreateInAllBranches] = useState(true);
  const parseMenu = useServerFn(parseMenuPdfText);


  const { data: cats = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name").order("sort_order")).data ?? [],
  });
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ["branches-all"],
    queryFn: async () => (await supabase.from("branches").select("id,name,is_main").order("is_main", { ascending: false })).data ?? [],
  });
  const { data: groups = [] } = useQuery<ModifierGroup[]>({
    queryKey: ["modifier-groups-all"],
    queryFn: async () => (await supabase.from("modifier_groups").select("id,name").order("name")).data ?? [],
  });
  const { data: supplies = [] } = useQuery<Supply[]>({
    queryKey: ["supplies-all"],
    queryFn: async () => (await supabase.from("supplies").select("id,name,unit").order("name")).data ?? [],
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products-all"],
    queryFn: async () => ((await supabase.from("products").select("*").order("name")).data ?? []) as unknown as Product[],
  });

  function openEditor(p: Partial<Product> | null) {
    setEditing(p);
    setShowRecipe(!!(p?.recipe && p.recipe.length > 0));
    setShowMods(!!(p?.modifier_group_ids && p.modifier_group_ids.length > 0));
  }

  async function save() {
    if (!editing) return;
    if (!editing.name?.trim()) return toast.error("Nombre requerido");
    const recipe = showRecipe ? (editing.recipe ?? []).filter((r) => r.supply_id && Number(r.qty) > 0) : [];
    const modifier_group_ids = showMods ? (editing.modifier_group_ids ?? []) : [];

    // Si es un hijo vinculado, confirmar desvinculación antes de guardar
    const isLinkedChild = !!editing.id && !!editing.source_product_id && editing.is_linked !== false;
    if (isLinkedChild) {
      const ok = confirm(
        "Este producto está vinculado a la sede principal y hereda sus cambios.\n\n" +
        "Si lo editas aquí, dejará de sincronizarse automáticamente con la sede principal.\n\n" +
        "¿Deseas continuar y personalizarlo para esta sede?"
      );
      if (!ok) return;
    }

    const payload: Record<string, unknown> = {
      name: editing.name.trim(),
      price: Number(editing.price ?? 0),
      category_id: editing.category_id ?? null,
      sku: editing.sku ?? null,
      active: editing.active ?? true,
      image_url: editing.image_url ?? null,
      allow_negative_stock: !!editing.allow_negative_stock,
      sold_by_weight: !!editing.sold_by_weight,
      show_in_online: editing.show_in_online ?? true,
      is_favorite: !!editing.is_favorite,
      available_branch_ids: editing.available_branch_ids && editing.available_branch_ids.length > 0 ? editing.available_branch_ids : null,
      modifier_group_ids: modifier_group_ids.length > 0 ? modifier_group_ids : null,
      recipe,
    };
    if (isLinkedChild) payload.is_linked = false;

    const { error } = editing.id
      ? await supabase.from("products").update(payload as never).eq("id", editing.id)
      : await supabase.from("products").insert(payload as never);
    if (error) return toast.error(error.message);
    // Cierra el modal ANTES de invalidar queries / mostrar toast para evitar
    // que Radix Dialog deje el <body> con pointer-events/overflow bloqueados
    // (produciría una pantalla en blanco al volver al listado en móvil).
    setEditing(null);
    setShowRecipe(false);
    setShowMods(false);
    // Esperar a que Radix termine su animación de cierre (~200ms) antes de
    // invalidar queries y mostrar la toast, para no interrumpir el desmontaje
    // del portal/overlay (causa raíz de la pantalla en blanco).
    setTimeout(() => {
      if (typeof document !== "undefined") {
        document.body.style.pointerEvents = "";
        document.body.style.overflow = "";
        document.body.removeAttribute("data-scroll-locked");
        // Elimina overlays huérfanos de Radix Dialog si quedaron pegados
        document
          .querySelectorAll('[data-radix-dialog-overlay][data-state="closed"]')
          .forEach((el) => el.remove());
      }
      toast.success(isLinkedChild ? "Guardado y desvinculado de la sede principal" : "Guardado");
      qc.invalidateQueries({ queryKey: ["products-all"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["public-products"] });
    }, 250);
  }


  async function resyncFromParent(childId: string) {
    if (!confirm("Volver a sincronizar este producto con la sede principal. Se sobrescribirán los cambios personalizados (excepto el stock). ¿Continuar?")) return;
    const { error } = await supabase.rpc("resync_product_from_parent", { _child_id: childId } as never);
    if (error) return toast.error(error.message);
    toast.success("Producto resincronizado con la sede principal");
    qc.invalidateQueries({ queryKey: ["products-all"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["public-products"] });
  }

  async function uploadImage(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await supabase.storage.from("products").upload(path, file, { upsert: true, contentType: file.type || `image/${ext}` });
    if (up.error) return toast.error(up.error.message);
    const { data: signed } = await supabase.storage.from("products").createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    if (signed?.signedUrl) {
      setEditing((prev) => ({ ...(prev ?? {}), image_url: signed.signedUrl }));
      toast.success("Foto subida");
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar producto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["products-all"] });
  }

  function toggleBranch(branchId: string) {
    const current = editing?.available_branch_ids ?? branches.map((b) => b.id);
    const next = current.includes(branchId) ? current.filter((id) => id !== branchId) : [...current, branchId];
    setEditing({ ...editing, available_branch_ids: next });
  }

  function toggleModGroup(gid: string) {
    const current = editing?.modifier_group_ids ?? [];
    const next = current.includes(gid) ? current.filter((id) => id !== gid) : [...current, gid];
    setEditing({ ...editing, modifier_group_ids: next });
  }

  function updateRecipe(idx: number, patch: Partial<RecipeItem>) {
    const list = [...(editing?.recipe ?? [])];
    list[idx] = { ...list[idx], ...patch };
    setEditing({ ...editing, recipe: list });
  }
  function addRecipeItem() {
    const list = [...(editing?.recipe ?? []), { supply_id: "", qty: 1 }];
    setEditing({ ...editing, recipe: list });
  }
  function removeRecipeItem(idx: number) {
    const list = [...(editing?.recipe ?? [])];
    list.splice(idx, 1);
    setEditing({ ...editing, recipe: list });
  }

  function openDuplicate(p: Product) {
    setDuplicating(p);
    setDupName(`${p.name} - Copia`);
    setDupCopyModsRecipe(true);
    const ids = p.available_branch_ids;
    const main = branches.find((b) => b.is_main);
    const sub = branches.find((b) => !b.is_main);
    setDupMain(main ? (!ids || ids.length === 0 || ids.includes(main.id)) : false);
    setDupBranch(sub ? (!ids || ids.length === 0 || ids.includes(sub.id)) : false);
  }

  async function confirmDuplicate() {
    if (!duplicating) return;
    if (!dupName.trim()) return toast.error("Nombre requerido");
    const targetBranchIds: string[] = [];
    const main = branches.find((b) => b.is_main);
    const sub = branches.find((b) => !b.is_main);
    if (dupMain && main) targetBranchIds.push(main.id);
    if (dupBranch && sub) targetBranchIds.push(sub.id);
    if (branches.length > 0 && targetBranchIds.length === 0) {
      return toast.error("Selecciona al menos una sede destino");
    }
    setDupSaving(true);
    const src = duplicating;
    const payload = {
      name: dupName.trim(),
      price: src.price,
      category_id: src.category_id ?? null,
      sku: null,
      active: src.active ?? true,
      image_url: src.image_url ?? null,
      allow_negative_stock: !!src.allow_negative_stock,
      sold_by_weight: !!src.sold_by_weight,
      show_in_online: src.show_in_online ?? true,
      is_favorite: !!src.is_favorite,
      available_branch_ids: targetBranchIds.length > 0 ? targetBranchIds : null,
      modifier_group_ids: dupCopyModsRecipe ? (src.modifier_group_ids ?? null) : null,
      recipe: dupCopyModsRecipe ? (src.recipe ?? []) : [],
    };
    const { error } = await supabase.from("products").insert(payload as never);
    setDupSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Producto duplicado correctamente");
    setDuplicating(null);
    qc.invalidateQueries({ queryKey: ["products-all"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["public-products"] });
  }

  function downloadTemplate() {
    const rows = [
      { "NOMBRE PRODUCTO": "Cono 1 Sabor", "CATEGORIA": "Helado", "PRECIO": 5000 },
      { "NOMBRE PRODUCTO": "Malteada Fresa", "CATEGORIA": "Malteadas", "PRECIO": 12000 },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header: ["NOMBRE PRODUCTO", "CATEGORIA", "PRECIO"] });
    ws["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos");
    XLSX.writeFile(wb, "plantilla-productos.xlsx");
  }

  async function importFromExcel(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rowsRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (!rowsRaw.length) { toast.error("El archivo está vacío"); return; }

      const norm = (s: string) => s.toString().trim().toLowerCase().replace(/\s+/g, " ");
      const findKey = (obj: Record<string, unknown>, candidates: string[]) => {
        const keys = Object.keys(obj);
        for (const c of candidates) {
          const k = keys.find((k) => norm(k) === norm(c));
          if (k) return k;
        }
        return null;
      };

      const first = rowsRaw[0];
      const kName = findKey(first, ["NOMBRE PRODUCTO", "NOMBRE", "PRODUCTO", "NAME"]);
      const kCat = findKey(first, ["CATEGORIA", "CATEGORÍA", "CATEGORY"]);
      const kPrice = findKey(first, ["PRECIO", "PRICE", "VALOR"]);
      if (!kName || !kPrice) { toast.error("El Excel debe tener columnas: NOMBRE PRODUCTO, CATEGORIA, PRECIO"); return; }

      const parsePrice = (v: unknown) => {
        if (typeof v === "number") return v;
        const s = String(v ?? "").replace(/[^0-9.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
        const n = Number(s);
        return isNaN(n) ? 0 : n;
      };

      const toTitle = (s: string) => {
        const t = s.trim().toLowerCase();
        return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
      };
      const items = rowsRaw
        .map((r) => ({
          name: String(r[kName!] ?? "").trim().toUpperCase(),
          category: kCat ? toTitle(String(r[kCat] ?? "")) : "",
          price: parsePrice(r[kPrice!]),
        }))
        .filter((r) => r.name && r.price > 0);

      if (!items.length) { toast.error("No se encontraron filas válidas"); return; }

      // Omitir productos ya existentes (por nombre, case-insensitive)
      const { data: existing } = await supabase.from("products").select("name");
      const existingSet = new Set((existing ?? []).map((p) => norm(p.name)));
      const toCreate: typeof items = [];
      const skipped: string[] = [];
      const seen = new Set<string>();
      for (const it of items) {
        const key = norm(it.name);
        if (existingSet.has(key) || seen.has(key)) { skipped.push(it.name); continue; }
        seen.add(key);
        toCreate.push(it);
      }

      if (!toCreate.length) {
        toast.info(`Todos los productos (${items.length}) ya existen. No se creó ninguno.`);
        return;
      }

      toast.info(`Importando ${toCreate.length} productos${skipped.length ? ` (${skipped.length} omitidos por existir)` : ""}...`);

      // Cache/crea categorías por nombre
      const catCache = new Map<string, string>();
      for (const c of cats) catCache.set(norm(c.name), c.id);
      const uniqueCats = Array.from(new Set(toCreate.map((i) => norm(i.category)).filter(Boolean)));
      for (const cn of uniqueCats) {
        if (catCache.has(cn)) continue;
        const original = toCreate.find((i) => norm(i.category) === cn)!.category;
        const { data, error } = await supabase.from("categories").insert({ name: original }).select("id").single();
        if (!error && data) catCache.set(cn, data.id);
      }

      const payload = toCreate.map((i) => ({
        name: i.name,
        price: i.price,
        category_id: i.category ? catCache.get(norm(i.category)) ?? null : null,
        active: true,
        show_in_online: true,
      }));

      const { error } = await supabase.from("products").insert(payload);
      if (error) { toast.error(`Error al importar: ${error.message}`); return; }

      toast.success(`✅ ${payload.length} productos importados${skipped.length ? ` · ${skipped.length} omitidos` : ""}`);

      qc.invalidateQueries({ queryKey: ["products-all"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["public-products"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      toast.error(`Error leyendo Excel: ${(e as Error).message}`);
    }
  }

  async function bulkInsertItems(itemsRaw: { name: string; category: string; price: number }[], sourceLabel: string) {
    const norm = (s: string) => s.toString().trim().toLowerCase().replace(/\s+/g, " ");
    const toTitle = (s: string) => {
      const t = s.trim().toLowerCase();
      return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
    };
    const items = itemsRaw.map((i) => ({
      name: (i.name || "").trim().toUpperCase(),
      category: toTitle(i.category || ""),
      price: i.price,
    }));
    if (!items.length) { toast.error(`No se encontraron productos en el ${sourceLabel}`); return; }

    const { data: existing } = await supabase.from("products").select("name");
    const existingSet = new Set((existing ?? []).map((p) => norm(p.name)));
    const toCreate: typeof items = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const key = norm(it.name);
      if (existingSet.has(key) || seen.has(key)) { skipped.push(it.name); continue; }
      seen.add(key);
      toCreate.push(it);
    }
    if (!toCreate.length) {
      toast.info(`Todos los productos (${items.length}) ya existen. No se creó ninguno.`);
      return;
    }
    toast.info(`Importando ${toCreate.length} productos${skipped.length ? ` (${skipped.length} omitidos)` : ""}...`);

    const catCache = new Map<string, string>();
    for (const c of cats) catCache.set(norm(c.name), c.id);
    const uniqueCats = Array.from(new Set(toCreate.map((i) => norm(i.category)).filter(Boolean)));
    for (const cn of uniqueCats) {
      if (catCache.has(cn)) continue;
      const original = toCreate.find((i) => norm(i.category) === cn)!.category;
      const { data, error } = await supabase.from("categories").insert({ name: original }).select("id").single();
      if (!error && data) catCache.set(cn, data.id);
    }
    const payload = toCreate.map((i) => ({
      name: i.name,
      price: i.price,
      category_id: i.category ? catCache.get(norm(i.category)) ?? null : null,
      active: true,
      show_in_online: true,
    }));
    const { error } = await supabase.from("products").insert(payload);
    if (error) { toast.error(`Error al importar: ${error.message}`); return; }
    toast.success(`✅ ${payload.length} productos importados${skipped.length ? ` · ${skipped.length} omitidos` : ""}`);
    qc.invalidateQueries({ queryKey: ["products-all"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["public-products"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
  }

  async function importFromPdf(file: File) {
    setPdfLoading(true);
    try {
      toast.info("Leyendo PDF...");
      // Carga dinámica de pdfjs para no impactar SSR
      const pdfjs: typeof import("pdfjs-dist") = await import("pdfjs-dist");
      // Worker vía CDN oficial
      (pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

      const buf = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      let fullText = "";
      const maxPages = Math.min(pdf.numPages, 20);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strs = content.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" ");
        fullText += strs + "\n";
      }
      fullText = fullText.trim();
      if (!fullText) { toast.error("No se pudo extraer texto del PDF"); return; }

      toast.info("Analizando menú con IA...");
      const result = await parseMenu({ data: { text: fullText } });
      const items = (result?.items ?? []) as { name: string; category: string; price: number }[];
      await bulkInsertItems(items, "PDF");
    } catch (e) {
      toast.error(`Error PDF: ${(e as Error).message}`);
    } finally {
      setPdfLoading(false);
    }
  }





  const branchSelected = (bid: string) => {
    const ids = editing?.available_branch_ids;
    if (!ids || ids.length === 0) return true; // null = todas
    return ids.includes(bid);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Productos</h1>
          <p className="text-muted-foreground">Items que se venden en la caja</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1" /> Plantilla Excel
            </Button>
            <Button variant="outline" asChild>
              <label className="cursor-pointer">
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Importar Excel
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFromExcel(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            <Button variant="outline" asChild disabled={pdfLoading}>
              <label className={pdfLoading ? "cursor-wait opacity-70" : "cursor-pointer"}>
                {pdfLoading
                  ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Procesando PDF...</>
                  : <><FileText className="h-4 w-4 mr-1" /> Importar PDF</>}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  disabled={pdfLoading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFromPdf(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            <CloneToBranchDialog branches={branches} qc={qc} />
            <Button onClick={() => openEditor({ active: true, show_in_online: true })}><Plus className="h-4 w-4 mr-1" /> Nuevo</Button>


            <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
            <DialogContent className="flex flex-col gap-0 p-0 w-[calc(100vw-1rem)] max-w-2xl max-h-[92dvh] rounded-2xl overflow-hidden">

              <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6 sm:py-4"><DialogTitle className="text-base sm:text-lg">{editing?.id ? "Editar" : "Nuevo"} producto</DialogTitle></DialogHeader>
              <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">

              {editing?.id && (() => {
                const isChild = !!editing.source_product_id;
                const isLinked = editing.is_linked !== false;
                if (isChild && isLinked) {
                  return (
                    <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                      <Link2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-medium text-primary">Vinculado a la sede principal</div>
                        <div className="text-muted-foreground">Este producto hereda automáticamente los cambios de la sede principal. Si lo editas aquí, dejará de sincronizarse.</div>
                      </div>
                    </div>
                  );
                }
                if (isChild && !isLinked) {
                  return (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                      <Link2Off className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-medium text-amber-700 dark:text-amber-500">Personalizado (desvinculado)</div>
                        <div className="text-muted-foreground">Los cambios en la sede principal ya no se aplican a este producto.</div>
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => resyncFromParent(editing.id!)}>
                        <RefreshCw className="h-3 w-3 mr-1" /> Resincronizar
                      </Button>
                    </div>
                  );
                }
                if (!isChild) {
                  return (
                    <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                      <Link2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="text-muted-foreground">Los cambios se aplicarán automáticamente a las copias vinculadas en las sucursales.</div>
                    </div>
                  );
                }
                return null;
              })()}
              <div className="space-y-4">
                {/* Foto del producto */}
                <div>
                  <Label className="mb-2 block">Foto del producto</Label>
                  <ImageDropzone
                    value={editing?.image_url ?? null}
                    onChange={(url) => setEditing((prev) => ({ ...(prev ?? {}), image_url: url }))}
                  />
                </div>
                <div><Label>Nombre</Label><Input value={editing?.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Precio (COP)</Label><Input type="number" value={editing?.price ?? 0} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} /></div>
                  <div><Label>SKU</Label><Input value={editing?.sku ?? ""} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} /></div>
                </div>
                <div>
                  <Label>Categoría</Label>
                  <Select value={editing?.category_id ?? "none"} onValueChange={(v) => setEditing({ ...editing, category_id: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin categoría</SelectItem>
                      {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2"><Switch checked={editing?.active ?? true} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /><Label>Activo</Label></div>

                {/* Configuraciones Avanzadas */}
                <div className="border-t pt-4">
                  <h3 className="font-display text-lg mb-3 flex items-center gap-2"><Star className="h-4 w-4 text-primary" /> Configuraciones Avanzadas</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <ToggleRow
                      label="⭐ Favoritos"
                      hint="Destácalo en el menú en línea y kiosko"
                      checked={!!editing?.is_favorite}
                      onChange={(v) => setEditing({ ...editing, is_favorite: v })}
                    />
                    <ToggleRow
                      label="Vender sin stock"
                      hint="Permite vender aunque el inventario esté en cero"
                      checked={!!editing?.allow_negative_stock}
                      onChange={(v) => setEditing({ ...editing, allow_negative_stock: v })}
                    />
                    <ToggleRow
                      label="Al granel"
                      hint="Vende por peso o volumen (acepta decimales)"
                      checked={!!editing?.sold_by_weight}
                      onChange={(v) => setEditing({ ...editing, sold_by_weight: v })}
                    />
                    <ToggleRow
                      label="Mostrar en Menú en Línea"
                      hint="Visible en el menú web y el kiosko de autoservicio"
                      checked={editing?.show_in_online ?? true}
                      onChange={(v) => setEditing({ ...editing, show_in_online: v })}
                    />
                  </div>

                  {/* Canales por sede */}
                  {branches.length > 0 && (
                    <div className="mt-4">
                      <Label className="mb-2 block">Canales de Venta Físicos (Sedes)</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {branches.map((b) => (
                          <ToggleRow
                            key={b.id}
                            label={`Mostrar en ${b.is_main ? "Punto de Venta Principal" : "Punto de Venta Sucursal"}`}
                            hint={b.name}
                            checked={branchSelected(b.id)}
                            onChange={() => toggleBranch(b.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recetas */}
                  <div className="mt-4">
                    <ToggleRow
                      label="Insumos / Receta"
                      hint="Descuento automático de materia prima por cada venta"
                      checked={showRecipe}
                      onChange={(v) => { setShowRecipe(v); if (!v) setEditing({ ...editing, recipe: [] }); }}
                    />
                    {showRecipe && (
                      <div className="mt-2 space-y-2 rounded-lg border bg-muted/30 p-3">
                        {(editing?.recipe ?? []).map((r, i) => (
                          <div key={i} className="grid grid-cols-[1fr_100px_auto] gap-2 items-center">
                            <Select value={r.supply_id} onValueChange={(v) => updateRecipe(i, { supply_id: v })}>
                              <SelectTrigger><SelectValue placeholder="Insumo" /></SelectTrigger>
                              <SelectContent>
                                {supplies.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.unit})</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Input type="number" step="0.01" value={r.qty} onChange={(e) => updateRecipe(i, { qty: Number(e.target.value) })} />
                            <Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => removeRecipeItem(i)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={addRecipeItem}><Plus className="h-3 w-3 mr-1" /> Agregar insumo</Button>
                        {supplies.length === 0 && <p className="text-xs text-muted-foreground">Aún no hay insumos creados.</p>}
                      </div>
                    )}
                  </div>

                  {/* Modificadores */}
                  <div className="mt-4">
                    <ToggleRow
                      label="Modificadores"
                      hint="Sabores, toppings, salsas a preguntar al ordenar"
                      checked={showMods}
                      onChange={(v) => { setShowMods(v); if (!v) setEditing({ ...editing, modifier_group_ids: [] }); }}
                    />
                    {showMods && (
                      <div className="mt-2 rounded-lg border bg-muted/30 p-3 space-y-2">
                        {groups.length === 0 && <p className="text-xs text-muted-foreground">Aún no hay grupos de modificadores.</p>}
                        {groups.map((g) => {
                          const checked = (editing?.modifier_group_ids ?? []).includes(g.id);
                          return (
                            <label key={g.id} className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-background">
                              <Checkbox checked={checked} onCheckedChange={() => toggleModGroup(g.id)} />
                              <span className="text-sm">{g.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              </div>
              <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6"><Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setEditing(null)}>Cancelar</Button><Button className="flex-1 sm:flex-none" onClick={save}>Guardar</Button></DialogFooter>
            </DialogContent>
            </Dialog>
          </div>
        )}

      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-16">Foto</TableHead><TableHead>Nombre</TableHead><TableHead>Categoría</TableHead><TableHead className="text-right">Precio</TableHead><TableHead>Estado</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => isAdmin && openEditor(p)}
                      className="group relative h-10 w-10 overflow-hidden rounded-md border bg-muted"
                      title={isAdmin ? "Cambiar foto" : ""}
                    >
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">{p.name.charAt(0)}</div>}
                      {isAdmin && (
                        <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white group-hover:flex">
                          <Camera className="h-4 w-4" />
                        </span>
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      onClick={() => isAdmin && openEditor(p)}
                      disabled={!isAdmin}
                      className="flex w-full items-center gap-1 flex-wrap text-left hover:text-primary hover:underline underline-offset-2 disabled:cursor-default disabled:no-underline disabled:hover:text-inherit"
                      title={isAdmin ? "Editar producto" : ""}
                    >
                      {p.is_favorite && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />}
                      {p.name}
                      {p.source_product_id && p.is_linked !== false && (
                        <Badge variant="outline" className="ml-1 gap-1 border-primary/40 text-primary text-[10px] px-1.5 py-0"><Link2 className="h-2.5 w-2.5" />Vinculado</Badge>
                      )}
                      {p.source_product_id && p.is_linked === false && (
                        <Badge variant="outline" className="ml-1 gap-1 border-amber-500/40 text-amber-700 dark:text-amber-500 text-[10px] px-1.5 py-0"><Link2Off className="h-2.5 w-2.5" />Personalizado</Badge>
                      )}
                    </button>
                  </TableCell>

                  <TableCell>{cats.find((c) => c.id === p.category_id)?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatMoney(p.price)}</TableCell>
                  <TableCell>{p.active ? "Activo" : "Inactivo"}</TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <>
                        {p.source_product_id && p.is_linked === false && (
                          <Button size="icon" variant="ghost" className="text-primary" onClick={() => resyncFromParent(p.id)} title="Resincronizar con la sede principal"><RefreshCw className="h-4 w-4" /></Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => openEditor(p)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="text-primary hover:bg-primary/10" onClick={() => openDuplicate(p)} title="Duplicar producto"><Copy className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(p.id)} title="Eliminar"><Trash2 className="h-4 w-4" /></Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {products.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin productos</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!duplicating} onOpenChange={(o) => !o && setDuplicating(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Copy className="h-5 w-5 text-primary" /> Duplicar Producto: {duplicating?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nuevo Nombre</Label>
              <Input value={dupName} onChange={(e) => setDupName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Sedes destino del duplicado</Label>
              <ToggleRow
                label="Duplicar en Punto de Venta Principal"
                hint="Sede Santa"
                checked={dupMain}
                onChange={setDupMain}
              />
              <ToggleRow
                label="Duplicar en Punto de Venta Sucursal"
                hint="Sede Parque"
                checked={dupBranch}
                onChange={setDupBranch}
              />
            </div>
            <ToggleRow
              label="Duplicar Modificadores y Recetas"
              hint="Copia los toppings, sabores e insumos del producto original"
              checked={dupCopyModsRecipe}
              onChange={setDupCopyModsRecipe}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicating(null)} disabled={dupSaving}>Cancelar</Button>
            <Button onClick={confirmDuplicate} disabled={dupSaving}>
              <Copy className="h-4 w-4 mr-1" /> {dupSaving ? "Duplicando..." : "Confirmar Duplicado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CloneToBranchDialog({
  branches,
  qc,
}: {
  branches: Branch[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const subs = branches.filter((b) => !b.is_main);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>(subs[0]?.id ?? "");
  const [loading, setLoading] = useState(false);

  if (subs.length === 0) return null;

  async function run() {
    if (!target) {
      toast.error("Selecciona una sede destino");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("clone_main_products_to_branch", { _branch_id: target });
      if (error) {
        toast.error(error.message);
        return;
      }
      const result = (data ?? {}) as { created?: number; skipped?: number };
      toast.success(
        `Clonado completo · ${result.created ?? 0} nuevos, ${result.skipped ?? 0} omitidos (ya existían)`,
      );
      qc.invalidateQueries({ queryKey: ["products-all"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <CopyPlus className="h-4 w-4 mr-1" /> Clonar a sucursal
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mostrar todos los productos de la sede principal en una sucursal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Copia todos los productos de la sede principal a la sucursal seleccionada, con sus
            categorías, precios, recetas, modificadores, imágenes y estado. Los productos que ya
            existan en la sucursal <b>no se duplican</b>.
          </p>
          <div className="space-y-1">
            <Label>Sede destino</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue placeholder="Selecciona sucursal" /></SelectTrigger>
              <SelectContent>
                {subs.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={run} disabled={loading || !target}>
            {loading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Clonando…</> : <><CopyPlus className="h-4 w-4 mr-1" /> Clonar productos</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

