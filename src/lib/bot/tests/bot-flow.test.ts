import { expect, test, describe } from "bun:test";
import { detectIntent } from "../nlu";
import { nextFsmState, missingCartFields, summarizeCart } from "../cart";
import { fallbackOrderReply, operationalReply } from "../replies";

describe("WhatsApp Bot Logic Validation", () => {
  const menuLink = "https://goloso.app/menu";

  describe("Scenario 1: Greeting", () => {
    test("detects greeting intent", () => {
      expect(detectIntent("Hola")).toBe("saludo");
      expect(detectIntent("Buenas tardes")).toBe("saludo");
    });

    test("generates greeting reply", () => {
      const reply = operationalReply(menuLink, true);
      expect(reply).toContain("Bienvenido");
      expect(reply).toContain(menuLink);
    });
  });

  describe("Scenario 2: Price Query", () => {
    test("detects price/menu intent", () => {
      expect(detectIntent("¿cuánto cuesta?")).toBe("precios");
      expect(detectIntent("ver menu")).toBe("menu");
      expect(detectIntent("precios")).toBe("precios");
    });

    test("fallback reply for prices contains menu link", () => {
      const reply = fallbackOrderReply("precios", menuLink, true, true);
      expect(reply).toContain(menuLink);
      expect(reply).toContain("precios");
    });
  });

  describe("Scenario 3: Product Ordering", () => {
    test("detects ordering intent", () => {
      expect(detectIntent("quiero pedir un helado")).toBe("pedido");
      expect(detectIntent("deme 2 malteadas")).toBe("pedido");
    });
  });

  describe("Scenario 4: Cart Modification", () => {
    test("detects cancel/modification intent", () => {
      expect(detectIntent("cancela el pedido")).toBe("cancelar");
      expect(detectIntent("cambiar por otra cosa")).toBe("modificar");
      expect(detectIntent("quitar producto")).toBe("eliminar");
    });
  });

  describe("Scenario 5: Checkout & FSM States", () => {
    test("detects confirmation intent", () => {
      expect(detectIntent("confirmo")).toBe("confirmar");
      expect(detectIntent("listo asi")).toBe("confirmar");
    });

    test("FSM transitions: GREETING -> SELECTING_PRODUCT -> COLLECTING_NAME -> ... -> AWAITING_CONFIRMATION", () => {
      // Empty cart
      expect(nextFsmState(null)).toBe("GREETING");

      // Item added, no customer info
      const cartWithItem = { 
        items: [{ product_name: "Helado", qty: 1, unit_price: 5000 }],
        subtotal: 5000,
        total: 5000
      };
      expect(nextFsmState(cartWithItem)).toBe("COLLECTING_NAME");

      // Name added, but delivery info missing
      const cartWithName = { ...cartWithItem, customer_name: "Juan", order_type: "delivery" };
      expect(nextFsmState(cartWithName)).toBe("COLLECTING_ADDRESS");

      // Address added, but neighborhood missing
      const cartWithAddress = { ...cartWithName, delivery_address: "Calle 10 #20-30" };
      expect(nextFsmState(cartWithAddress)).toBe("COLLECTING_NEIGHBORHOOD");

      // All info present
      const completeCart = { 
        ...cartWithAddress, 
        delivery_neighborhood: "Centro", 
        payment_method: "efectivo" 
      };
      expect(nextFsmState(completeCart)).toBe("AWAITING_CONFIRMATION");
    });

    test("identifies missing fields correctly", () => {
      const cart = { items: [{}], order_type: "delivery", customer_name: "Juan" };
      const missing = missingCartFields(cart);
      expect(missing).toContain("dirección");
      expect(missing).toContain("barrio");
      expect(missing).toContain("método de pago");
    });

    test("summarizes cart correctly", () => {
      const cart = { 
        items: [{ product_name: "Helado", qty: 2, unit_price: 5000 }],
        subtotal: 10000,
        delivery_fee: 2000,
        total: 12000
      };
      const summary = summarizeCart(cart, (n) => `$${n}`);
      expect(summary).toContain("2 x Helado");
      expect(summary).toContain("Subtotal: $10000");
      expect(summary).toContain("Total: $12000");
    });
  });
});
