// Definición de herramientas (function calling) expuestas al modelo.
// Se mantiene separada del motor para poder versionar/ajustar el contrato
// sin tocar la lógica de orquestación.

export const ORDERING_TOOLS = [
  { type: "function", function: { name: "search_products", description: "Busca productos activos de la sede por nombre. Devuelve id, name, price, modifier_group_ids.", parameters: { type: "object", properties: { query: { type: "string", description: "Palabra clave del producto que busca el cliente." } }, required: ["query"] } } },
  { type: "function", function: { name: "get_modifiers", description: "Obtiene los grupos de modificadores (sabores, toppings) disponibles para un producto.", parameters: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] } } },
  { type: "function", function: { name: "add_to_cart", description: "Agrega un item al carrito del cliente. Los modificadores deben venir con id, name y price obtenidos de get_modifiers.", parameters: { type: "object", properties: { product_id: { type: "string" }, product_name: { type: "string" }, unit_price: { type: "number" }, qty: { type: "number" }, modifiers: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, price: { type: "number" } } } }, notes: { type: "string" } }, required: ["product_name", "unit_price", "qty"] } } },
  { type: "function", function: { name: "set_delivery_info", description: "Guarda los datos de entrega, tipo de pedido y pago en el carrito.", parameters: { type: "object", properties: { order_type: { type: "string", description: "'delivery' para domicilio o 'pickup' para recoger" }, customer_name: { type: "string" }, delivery_address: { type: "string" }, delivery_neighborhood: { type: "string" }, delivery_notes: { type: "string" }, payment_method: { type: "string", description: "'cash' o 'transfer'" }, delivery_fee: { type: "number" } } } } },
  { type: "function", function: { name: "show_cart", description: "Muestra el contenido actual del carrito (útil antes de confirmar).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "confirm_order", description: "Confirma el pedido y lo envía al POS. Solo llámalo cuando el cliente lo confirme explícitamente.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "cancel_order", description: "Cancela el carrito en construcción.", parameters: { type: "object", properties: {} } } },
] as const;
