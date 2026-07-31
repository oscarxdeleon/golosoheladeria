import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { detectIntent } from "../nlu";
import { nextFsmState, missingCartFields, summarizeCart } from "../cart";
import { fallbackOrderReply, operationalReply } from "../replies";

describe("WhatsApp Bot Logic Validation", () => {
  const menuLink = "https://goloso.app/menu";

  describe("Scenario 1: Greeting", () => {
    test("detects greeting intent", () => {
      assert.equal(detectIntent("Hola"), "saludo");
      assert.equal(detectIntent("Buenas tardes"), "saludo");
    });

    test("generates greeting reply", () => {
      const reply = operationalReply(menuLink, true);
      assert.match(reply, /Bienvenido/);
      assert.match(reply, new RegExp(menuLink.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
  });

  describe("Scenario 2: Price Query", () => {
    test("detects price/menu intent", () => {
      assert.equal(detectIntent("¿cuánto cuesta?"), "precios");
      assert.equal(detectIntent("ver menu"), "menu");
      assert.equal(detectIntent("precios"), "precios");
    });

    test("price fallback asks for the product without resending the menu", () => {
      const reply = fallbackOrderReply("precios", menuLink, true, true);
      assert.doesNotMatch(reply, /https?:\/\//);
      assert.match(reply, /producto/i);
    });
  });

  describe("Scenario 3: Product Ordering", () => {
    test("detects ordering intent", () => {
      assert.equal(detectIntent("quiero pedir un helado"), "pedido");
      assert.equal(detectIntent("deme 2 malteadas"), "pedido");
    });
  });

  describe("Scenario 4: Cart Modification", () => {
    test("detects cancel/modification intent", () => {
      assert.equal(detectIntent("cancela el pedido"), "cancelar");
      assert.equal(detectIntent("cambiar por otra cosa"), "modificar");
      assert.equal(detectIntent("quitar producto"), "eliminar");
    });
  });

  describe("Scenario 5: Checkout & FSM States", () => {
    test("detects confirmation intent", () => {
      assert.equal(detectIntent("confirmo"), "confirmar");
      assert.equal(detectIntent("listo asi"), "confirmar");
    });

    test("FSM transitions: GREETING -> SELECTING_PRODUCT -> COLLECTING_NAME -> ... -> AWAITING_CONFIRMATION", () => {
      // Empty cart
      assert.equal(nextFsmState(null), "GREETING");

      // Item added, no customer info
      const cartWithItem = { 
        items: [{ product_name: "Helado", qty: 1, unit_price: 5000 }],
        subtotal: 5000,
        total: 5000
      };
      assert.equal(nextFsmState(cartWithItem), "COLLECTING_NAME");

      // Name added, but delivery info missing
      const cartWithName = { ...cartWithItem, customer_name: "Juan", order_type: "delivery" };
      assert.equal(nextFsmState(cartWithName), "COLLECTING_ADDRESS");

      // Address added, but neighborhood missing
      const cartWithAddress = { ...cartWithName, delivery_address: "Calle 10 #20-30" };
      assert.equal(nextFsmState(cartWithAddress), "COLLECTING_NEIGHBORHOOD");

      // All info present
      const completeCart = { 
        ...cartWithAddress, 
        delivery_neighborhood: "Centro", 
        payment_method: "efectivo" 
      };
      assert.equal(nextFsmState(completeCart), "AWAITING_CONFIRMATION");
    });

    test("identifies missing fields correctly", () => {
      const cart = { items: [{}], order_type: "delivery", customer_name: "Juan" };
      const missing = missingCartFields(cart);
      assert.ok(missing.includes("dirección"));
      assert.ok(missing.includes("barrio"));
      assert.ok(missing.includes("método de pago"));
    });

    test("summarizes cart correctly", () => {
      const cart = { 
        items: [{ product_name: "Helado", qty: 2, unit_price: 5000 }],
        subtotal: 10000,
        delivery_fee: 2000,
        total: 12000
      };
      const summary = summarizeCart(cart, (n) => `$${n}`);
      assert.match(summary, /2 x Helado/);
      assert.match(summary, /Subtotal: \$10000/);
      assert.match(summary, /Total: \$12000/);
    });
  });
});
