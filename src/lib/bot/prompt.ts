// Constructores de bloques del system prompt del asistente.
// Módulo puro: no hace I/O, solo arma texto a partir del estado ya cargado.
import { formatCOP } from "@/lib/bot/backend";
import { cartItems, effectiveOrderType, fieldText, missingCartFields, nextFsmState } from "@/lib/bot/cart";

type Cart = Record<string, unknown> | null | undefined;

export type OrderingCfg = {
  min_amount?: unknown;
  delivery_fee?: unknown;
  zones?: unknown;
  transfer_info?: unknown;
  dry_run?: unknown;
} | null | undefined;

/** Reglas de toma de pedidos por WhatsApp (solo domicilio). */
export function buildOrderingPromptBlock(orderCfg: OrderingCfg, onlineOpen: boolean, dryRun: boolean) {
  return [
    "",
    "🛒 TOMA DE PEDIDOS (SOLO DOMICILIO):",
    "- REGLA SUPERIOR: si el cliente dice que quiere pedir, menciona un producto, una cantidad, un sabor, dirección o pago, NO respondas solo con el link del menú. Atiéndelo por WhatsApp y avanza el pedido paso a paso usando las herramientas.",
    `- Domicilio: ${onlineOpen ? "ABIERTO" : "CERRADO — no aceptes pedidos ahora, invita a volver en horario"}.`,
    `- Monto mínimo del pedido (subtotal antes de domicilio): ${formatCOP(Number(orderCfg?.min_amount ?? 0))}.`,
    `- Costo de domicilio por defecto: ${formatCOP(Number(orderCfg?.delivery_fee ?? 0))} (ajústalo si la zona lo requiere).`,
    orderCfg?.zones ? `- Zonas de cobertura: ${orderCfg.zones}` : "",
    orderCfg?.transfer_info ? `- Datos de transferencia (compártelos SOLO si el cliente elige transferir): ${orderCfg.transfer_info}` : "",
    "",
    "🛑 REGLAS DURAS ANTIRRIESGO (violarlas rechaza la venta):",
    "- NO registres, agregues ni asumas NINGÚN producto por iniciativa propia. Solo agregas al carrito lo que el cliente pidió con palabras claras.",
    "- NO uses add_to_cart hasta que el cliente diga QUÉ producto quiere Y hayas confirmado con él TODOS los modificadores obligatorios (sabor, tamaño, toppings requeridos). Si el producto tiene grupos requeridos y no tienes las opciones elegidas por el cliente, get_modifiers primero y pregúntale con lista clara: 'Para el/la X, ¿qué [sabor/tamaño] eliges? Tenemos: A, B, C'.",
    "- NUNCA elijas un modificador por el cliente. Si duda, ofrece las opciones y espera su respuesta.",
    "- Si el cliente solo saluda, pregunta precios o pide el menú, NO llames add_to_cart. Responde y espera a que él pida.",
    "- Un mensaje realmente ambiguo (\"quiero algo rico\", \"lo de siempre\") requiere aclaración. \"Quiero/necesito un helado\" SÍ inicia un pedido: busca las presentaciones reales del catálogo y pregunta cuál prefiere (vaso, cono, copa u otra disponible), sin agregar nada hasta que la elija.",
    "- Solo llama confirm_order cuando el cliente diga explícitamente SÍ/CONFIRMO/DALE tras ver el resumen completo. Un simple \"ok\" o \"listo\" a media conversación NO confirma.",
    "",
    "PROTOCOLO OBLIGATORIO PARA TOMAR PEDIDOS:",
    "1) Usa search_products para encontrar el producto exacto que pide el cliente (no inventes precios).",
    "2) Si el producto tiene grupos de modificadores, llama get_modifiers, muéstrale al cliente SOLO esas opciones y espera su elección. NO asumas ni pongas por defecto.",
    "3) Cuando tengas producto+modificadores CONFIRMADOS por el cliente+cantidad, llama add_to_cart. Si el servidor responde 'missing_required_modifiers', significa que faltó preguntar: hazlo y vuelve a intentar.",
    "3.1) Si pide quitar un producto usa remove_cart_item. Si cambia cantidad, sabor, modificadores u observaciones usa update_cart_item. Después muestra el carrito actualizado.",
    "4) Pregunta y guarda con set_delivery_info los datos EN ESTE ORDEN, SIN OMITIR NINGUNO:",
    "   a) NOMBRE del cliente (OBLIGATORIO — SIEMPRE pregunta primero '¿A nombre de quién registro el pedido?' y NO continues con dirección/barrio/pago hasta tenerlo).",
    "   b) Dirección completa.",
    "   c) Barrio.",
    "   d) Método de pago (cash o transfer).",
    "   e) Notas adicionales si aplica.",
    "   ⚠️ NUNCA llames confirm_order si no has capturado el NOMBRE del cliente. Si intentas confirmar sin nombre, el sistema rechazará el pedido.",
    "5) Antes de confirmar, muestra un RESUMEN completo incluyendo NOMBRE del cliente, productos, subtotal, domicilio, total y método de pago; pide confirmación explícita ('¿Confirmas el pedido, [nombre]?').",
    "6) Solo cuando el cliente diga SÍ / CONFIRMO / DALE, llama confirm_order. Devolverá el nº de pedido.",
    "7) Si el cliente cambia de opinión, llama cancel_order.",
    "8) Recuerda: el pedido queda PENDIENTE DE REVISIÓN por el cajero. Dile al cliente: 'Tu pedido quedó registrado con el nº X y será confirmado en unos minutos por nuestro equipo.'",
    dryRun ? "⚠️ MODO PRUEBA ACTIVO: al llamar confirm_order NO se registra pedido real; devuelve un nº simulado. Igual muestra el resumen normal al cliente; internamente sabrás que fue simulado por la respuesta del tool." : "",
    "",
  ].filter(Boolean).join("\n");
}

/**
 * Estado exacto del carrito activo. Evita que el modelo reinicie el flujo
 * o pregunte datos ya capturados.
 */
export function buildCartStateBlock(preloadedCart: Cart) {
  if (!preloadedCart) return "";
  const items = cartItems(preloadedCart);
  const fsmState = String(preloadedCart.fsm_state ?? nextFsmState(preloadedCart));
  const name = fieldText(preloadedCart, "customer_name");
  const addr = fieldText(preloadedCart, "delivery_address");
  const nbh = fieldText(preloadedCart, "delivery_neighborhood");
  const pay = fieldText(preloadedCart, "payment_method");
  const notes = fieldText(preloadedCart, "delivery_notes");
  const otype = effectiveOrderType(preloadedCart);
  const missing = missingCartFields(preloadedCart);
  const hasAny = items.length > 0 || name || addr || nbh || pay;
  if (!hasAny) return "";
  const lines: string[] = [
    "",
    "════════ ESTADO ACTUAL DEL PEDIDO EN CURSO (memoria del cliente) ════════",
    "USA ESTA INFORMACIÓN COMO VERDAD ABSOLUTA. NO vuelvas a saludar. NO envíes el link del menú. NO reinicies el flujo. NO preguntes datos ya listados abajo. NO digas 'no tengo pedido registrado'.",
    `- Estado FSM actual: ${fsmState}`,
    `- Tipo: ${otype === "pickup" ? "recoger en tienda" : "domicilio"}`,
  ];
  if (items.length > 0) {
    lines.push("- Productos en el carrito:");
    for (const it of items) {
      const qty = Number(it.qty ?? 1);
      const nm = String(it.product_name ?? it.name ?? "Producto");
      const up = Number(it.unit_price ?? 0);
      const mods = Array.isArray(it.modifiers)
        ? (it.modifiers as Array<Record<string, unknown>>).map((m) => String(m?.name ?? "")).filter(Boolean).join(", ")
        : "";
      const iNotes = String(it.notes ?? "").trim();
      lines.push(`  • ${qty} × ${nm} — ${formatCOP(qty * up)}${mods ? ` [${mods}]` : ""}${iNotes ? ` (notas: ${iNotes})` : ""}`);
    }
    lines.push(`- Subtotal: ${formatCOP(Number(preloadedCart.subtotal ?? 0))}`);
    if (Number(preloadedCart.delivery_fee ?? 0) > 0) lines.push(`- Domicilio: ${formatCOP(Number(preloadedCart.delivery_fee))}`);
    lines.push(`- Total: ${formatCOP(Number(preloadedCart.total ?? 0))}`);
  } else {
    lines.push("- Productos: (aún sin items — el cliente ya nos dio datos y estamos armando el pedido)");
  }
  if (name) lines.push(`- Nombre: ${name}`);
  if (addr) lines.push(`- Dirección: ${addr}`);
  if (nbh) lines.push(`- Barrio: ${nbh}`);
  if (pay) lines.push(`- Pago: ${pay}`);
  if (notes) lines.push(`- Notas: ${notes}`);
  if (missing.length > 0) {
    lines.push(`- FALTA por capturar: ${missing.join(", ")}. Pregunta SOLO lo que falta, UNA cosa a la vez. NO repitas lo que ya está arriba.`);
  } else if (items.length > 0) {
    lines.push("- Datos completos. Muestra RESUMEN y pide confirmación explícita antes de llamar confirm_order. Si el cliente acaba de decir sí/confirmo, el servidor confirmará de forma determinística.");
  }
  lines.push("════════════════════════════════════════════════════════════");
  return lines.join("\n");
}

/** Producto en configuración: impide que el modelo cambie de producto. */
export function buildPendingProductBlock(preloadedCart: Cart) {
  const pp = (preloadedCart && typeof preloadedCart === "object")
    ? (preloadedCart as Record<string, unknown>).pending_product as { id?: string; name?: string; price?: number } | null | undefined
    : null;
  if (!pp || !pp.name) return "";
  return [
    "",
    "════════ PRODUCTO ACTIVO EN CONFIGURACIÓN ════════",
    `El cliente YA eligió: "${pp.name}". Estás preguntando/confirmando sus modificadores (sabores, toppings, tamaño, cantidad).`,
    "REGLAS DURAS:",
    `- NO cambies el producto. Sigue siempre con "${pp.name}" hasta que se agregue al carrito o el cliente lo cancele explícitamente.`,
    "- NO ofrezcas presentaciones ni productos alternativos (por ejemplo NO preguntes '¿Cono o Vaso?' si el producto activo es una Copa/Ensalada/Banana Split/Malteada específica).",
    "- Interpreta las respuestas del cliente (sabores, toppings, cantidades, notas) SIEMPRE como parte de la configuración de ESTE producto.",
    "- Pregunta ÚNICAMENTE los modificadores obligatorios pendientes de ESTE producto, uno a la vez.",
    "- Cuando tengas todos los modificadores obligatorios elegidos por el cliente, llama add_to_cart con este product_id exacto.",
    `- product_id activo: ${pp.id ?? "(desconocido)"} · precio base: $${Math.round(Number(pp.price ?? 0)).toLocaleString("es-CO")}`,
    "════════════════════════════════════════════════════════════",
  ].join("\n");
}

/** Continuidad: saludo único, memoria e intención del turno. */
export function buildContinuityBlock(alreadyGreeted: boolean, turnIntent: string) {
  return [
    "",
    "════════ CONTINUIDAD DE LA CONVERSACIÓN (REGLA MÁXIMA) ════════",
    alreadyGreeted
      ? "⛔ ESTA CONVERSACIÓN YA ESTÁ INICIADA. PROHIBIDO saludar, presentarte, decir '¡Hola!', 'Soy Golosito', 'Bienvenido' o reenviar el link del menú por iniciativa propia. Continúa exactamente donde quedó la conversación."
      : "✅ Es el PRIMER mensaje de esta conversación: preséntate UNA sola vez ('Hola 👋 Soy Golosito, el asistente de Heladería Goloso.') y atiende de inmediato lo que pide el cliente.",
    `Intención detectada en este mensaje: ${turnIntent}. Responde específicamente a esa intención, con un flujo propio; nunca respondas lo mismo para todas las consultas.`,
    "MEMORIA (obligatoria): recuerda producto, cantidad, sabores, toppings, modificaciones, nombre del cliente, dirección, barrio, sede y tipo de pedido (domicilio o recoger). NUNCA vuelvas a preguntar un dato que el cliente ya respondió en esta conversación.",
    "Pregunta ÚNICAMENTE el dato que falta, de a uno por mensaje, y en el mismo orden lógico del pedido.",
    "Si ya hay un pedido en curso, PROHIBIDO reenviar el link del menú o reiniciar el flujo: continúa donde quedó.",
    "PROHIBIDO repetir textualmente tu mensaje anterior o volver a hacer la misma pregunta. Si el cliente no fue claro, pide la aclaración de otra forma.",
    "Si un dato ya está en el carrito o en el historial, dalo por recibido.",
    "Si el cliente pide hablar con un asesor, dile que un asesor continuará por este chat y deja de insistir con el pedido.",
    "Nunca inventes productos, precios, sabores ni promociones: usa solo la información del POS incluida abajo o consulta con las herramientas.",
    "DISPONIBILIDAD (regla dura): si un producto aparece en el catálogo del POS incluido abajo, ESTÁ DISPONIBLE. PROHIBIDO decir 'no lo tenemos', 'no manejamos', 'no está disponible' o 'no lo veo en el menú' para un producto que sí figura en el catálogo. Antes de negar cualquier producto, búscalo en el catálogo (incluye variantes de nombre, singular/plural y sin tildes) y, si no lo encuentras, ofrece el menú en lugar de afirmar que no existe.",
    "Expresiones naturales permitidas: 'Claro 😊', 'Con mucho gusto', 'Excelente elección', 'Perfecto', 'Déjame verificar', 'Ya te cuento'.",
    "════════════════════════════════════════════════════════════",
    "",
  ].join("\n");
}
