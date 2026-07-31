import { expect, test, describe, spyOn } from "bun:test";
import { runBotAction } from "../engine";
import * as backend from "../backend";

// Mock environment
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mock";

describe("WhatsApp Bot Conversation Flows (Deterministic)", () => {
  const token = "mock_token_1234567890";
  const phone = "573001234567";

  function createRequest(action: string, data: any) {
    return new Request("http://localhost/api/bot", {
      method: "POST",
      body: JSON.stringify({ action, token, from: phone, ...data }),
    });
  }

  test("Greeting once: returns operational greeting", async () => {
    const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
      if (name === "whatsapp_bot_handle_incoming") {
        return { 
          ok: true, 
          status: 200, 
          data: { 
            reply: "¡Hola! 👋🍦 Bienvenido a Heladería Goloso. Cuéntame qué te provoca y lo pedimos.", 
            use_ai: false 
          } 
        };
      }
      return { ok: true, status: 200, data: {} };
    });

    const res = await runBotAction(createRequest("incoming", { message: "Hola" }));
    const data = await res.json();

    expect(data.reply).toContain("Bienvenido");
    rpcSpy.mockRestore();
  });

  test("Price query: returns menu link", async () => {
    const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
      if (name === "whatsapp_bot_handle_incoming") {
        return { 
          ok: true, 
          status: 200, 
          data: { 
            reply: "Aquí tienes nuestro menú con precios 👉 https://goloso.app/menu", 
            use_ai: false 
          } 
        };
      }
      return { ok: true, status: 200, data: {} };
    });

    const res = await runBotAction(createRequest("incoming", { message: "precios" }));
    const data = await res.json();

    expect(data.reply).toContain("menú");
    expect(data.reply).toContain("https://");
    rpcSpy.mockRestore();
  });

  test("Product ordering: hand-off to AI for complex requests", async () => {
    const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
      if (name === "whatsapp_bot_handle_incoming") {
        // Deterministic engine says "I don't know, use AI"
        return { ok: true, status: 200, data: { reply: null, use_ai: true } };
      }
      return { ok: true, status: 200, data: {} };
    });

    const res = await runBotAction(createRequest("incoming", { message: "quiero 2 malteadas de fresa" }));
    const data = await res.json();

    expect(data.use_ai).toBe(true);
    rpcSpy.mockRestore();
  });

  test("Cart modification: cancel intent detection", async () => {
    const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
      if (name === "whatsapp_bot_handle_incoming") {
        return { ok: true, status: 200, data: { reply: "Listo, cancelé lo que teníamos en curso.", use_ai: false } };
      }
      return { ok: true, status: 200, data: {} };
    });

    const res = await runBotAction(createRequest("incoming", { message: "cancela el pedido" }));
    const data = await res.json();

    expect(data.reply).toContain("cancelé");
    rpcSpy.mockRestore();
  });

  test("Checkout: confirmation intent detection", async () => {
    const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
      if (name === "whatsapp_bot_handle_incoming") {
        return { ok: true, status: 200, data: { reply: "Perfecto, déjame verificar tu pedido.", use_ai: false } };
      }
      return { ok: true, status: 200, data: {} };
    });

    const res = await runBotAction(createRequest("incoming", { message: "confirmo" }));
    const data = await res.json();

    expect(data.reply).toContain("verificar");
    rpcSpy.mockRestore();
  });
});
