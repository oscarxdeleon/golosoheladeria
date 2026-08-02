import { ProductLite, normalizeText } from "@/lib/bot/nlu";

/**
 * Emparejador determinista del catálogo real de la sede.
 *
 * Objetivo: que el asistente NUNCA responda "no te entendí" cuando el cliente
 * menciona algo que existe en el menú, incluso si la IA no está disponible
 * (sin clave, cuota agotada, 429/402 o timeout). Funciona con:
 *  - coincidencia por tokens (palabras completas y prefijos)
 *  - tolerancia a errores de escritura (distancia de edición)
 *  - sinónimos y variantes coloquiales colombianas
 */

const SYNONYMS: Record<string, string[]> = {
  ensalada: ["ensalada", "ensaladas", "ensalada de frutas", "frutas"],
  malteada: ["malteada", "malteadas", "batido", "batidos", "shake"],
  helado: ["helado", "helados", "nieve", "mantecado"],
  cono: ["cono", "conos", "barquillo", "barquillos"],
  copa: ["copa", "copas", "sundae"],
  jugo: ["jugo", "jugos", "zumo", "natural"],
  waffle: ["waffle", "wafle", "wafles", "waffles"],
  crepe: ["crepe", "crepes", "creps", "crep"],
  banana: ["banana split", "banana", "banano"],
  brownie: ["brownie", "brownies"],
  obleas: ["oblea", "obleas"],
  gaseosa: ["gaseosa", "gaseosas", "soda", "refresco"],
  cafe: ["cafe", "capuchino", "cappuccino", "latte", "tinto"],
  perro: ["perro", "perros", "perro caliente", "hot dog"],
  hamburguesa: ["hamburguesa", "hamburguesas", "burger"],
  granizado: ["granizado", "granizados", "cholado"],
};

function editDistance(a: string, b: string) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let last = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      last = tmp;
    }
  }
  return prev[b.length] as number;
}

function words(value: string) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3);
}

const STOP = new Set([
  "para", "por", "con", "una", "uno", "unos", "unas", "que", "los", "las",
  "del", "dame", "quiero", "necesito", "regalame", "tienen", "tienes", "hay",
  "cuanto", "cuesta", "vale", "precio", "porfa", "favor", "please", "pedido",
  "domicilio", "mesa", "gracias", "buenas", "hola",
]);

function tokenMatches(token: string, targetTokens: string[]) {
  for (const target of targetTokens) {
    if (target === token) return 1;
    if (target.startsWith(token) || token.startsWith(target)) return 0.85;
    if (token.length >= 5 && editDistance(token, target) <= 1) return 0.7;
    if (token.length >= 7 && editDistance(token, target) <= 2) return 0.55;
  }
  return 0;
}

function expandInput(input: string) {
  const base = words(input).filter((w) => !STOP.has(w));
  const extra: string[] = [];
  const normalized = normalizeText(input);
  for (const [canonical, variants] of Object.entries(SYNONYMS)) {
    if (variants.some((v) => normalized.includes(normalizeText(v)))) extra.push(canonical);
  }
  return Array.from(new Set([...base, ...extra]));
}

export type CatalogMatch = { product: ProductLite; score: number };

/** Devuelve los productos del catálogo que mejor coinciden con el texto. */
export function matchCatalogProducts(products: ProductLite[], input: string, limit = 6): CatalogMatch[] {
  const tokens = expandInput(input);
  if (tokens.length === 0) return [];
  const scored: CatalogMatch[] = [];
  for (const product of products) {
    if (!product?.name) continue;
    const nameTokens = words(String(product.name));
    const catTokens = words(String(product.category ?? ""));
    let score = 0;
    for (const token of tokens) {
      score += tokenMatches(token, nameTokens) * 1;
      score += tokenMatches(token, catTokens) * 0.6;
    }
    if (score >= 0.55) scored.push({ product, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Detecta si el cliente preguntó por una categoría completa ("qué ensaladas tienen"). */
export function matchCatalogCategory(products: ProductLite[], input: string): string | null {
  const tokens = expandInput(input);
  if (tokens.length === 0) return null;
  const categories = Array.from(
    new Set(products.map((p) => String(p.category ?? "")).filter((c) => c.trim().length > 0)),
  );
  let best: { category: string; score: number } | null = null;
  for (const category of categories) {
    const catTokens = words(category);
    let score = 0;
    for (const token of tokens) score += tokenMatches(token, catTokens);
    if (score > 0 && (!best || score > best.score)) best = { category, score };
  }
  return best && best.score >= 0.85 ? best.category : null;
}

/**
 * Respuesta comercial determinista basada en el catálogo real.
 * Se usa cuando la IA no está disponible: en vez de "no te entendí",
 * el asistente muestra productos reales con precios reales y avanza el pedido.
 */
export function buildCatalogReply(
  allProducts: ProductLite[],
  input: string,
  fmtCOP: (value: number) => string,
  orderingEnabled: boolean,
): string | null {
  if (!Array.isArray(allProducts) || allProducts.length === 0) return null;
  // Deduplicamos por nombre: el catálogo puede traer el mismo producto
  // replicado entre sedes y el cliente no debe ver la lista repetida.
  const seen = new Set<string>();
  const products = allProducts.filter((p) => {
    const key = normalizeText(String(p?.name ?? ""));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const category = matchCatalogCategory(products, input);
  if (category) {
    const items = products
      .filter((p) => String(p.category ?? "") === category && typeof p.price === "number")
      .slice(0, 8);
    if (items.length > 0) {
      const list = items.map((p) => `• ${p.name} — ${fmtCOP(Number(p.price))}`).join("\n");
      return `En ${category} tenemos:\n${list}\n\n${orderingEnabled ? "¿Cuál te preparo? 😊" : "¿Te cuento algo más?"}`;
    }
  }

  const matches = matchCatalogProducts(products, input, 5).filter(
    (m) => typeof m.product.price === "number",
  );
  if (matches.length === 0) return null;

  const top = matches[0];
  if (!top) return null;

  if (matches.length === 1 || top.score >= (matches[1]?.score ?? 0) + 0.9) {
    const price = fmtCOP(Number(top.product.price));
    return orderingEnabled
      ? `¡Claro! ${top.product.name} cuesta ${price}. ¿Cuántas te preparo? 🍦`
      : `${top.product.name} cuesta ${price} 🍦`;
  }

  const list = matches
    .slice(0, 5)
    .map((m) => `• ${m.product.name} — ${fmtCOP(Number(m.product.price))}`)
    .join("\n");
  return `Tenemos estas opciones:\n${list}\n\n${orderingEnabled ? "¿Cuál te sirvo? 😊" : "¿Te cuento algo más?"}`;
}
