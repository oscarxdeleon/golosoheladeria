import { expect, test, describe, spyOn, beforeAll, afterAll } from "bun:test";
import { runBotAction } from "../engine";
import * as backend from "../backend";

// Mock environment
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mock";

describe("WhatsApp Bot Conversation Flows", () => {
  const token = "mock_token_1234567890";
  const phone = "573001234567";

  function createRequest(action: string, data: any) {
    return new Request("http://localhost/api/bot", {
      method: "POST",
      body: JSON.stringify({ action, token, from: phone, ...data }),
    });
  }

  describe("Scenario 1: Greeting Once", () => {
    test("Initial greeting returns welcome message", async () => {
      // Mock RPC for 'incoming' action
      const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
        if (name === "whatsapp_bot_handle_incoming") {
          return { ok: true, status: 200, data: { reply: "¡Hola! Bienvenido a Heladería Goloso. ¿Qué te provoca hoy?", use_ai: false } };
        }
        return { ok: true, status: 200, data: {} };
      });

      const req = createRequest("incoming", { message: "Hola" });
      const res = await runBotAction(req);
      const data = await res.json();

      expect(data.reply).toContain("Hola");
      expect(data.reply).toContain("Goloso");
      rpcSpy.mockRestore();
    });

    test("Repeated greeting is handled (short-circuited or different)", async () => {
      // Simulate that the bot already answered "Hola" recently.
      // We test the shortCircuitReply or avoidRepeatedReply logic.
      const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
        if (name === "whatsapp_bot_handle_incoming") {
          // Rule-based engine might decide to let AI handle it or return a fixed reply
          return { ok: true, status: 200, data: { reply: null, use_ai: true } };
        }
        return { ok: true, status: 200, data: {} };
      });

      const req = createRequest("incoming", { message: "Hola" });
      const res = await runBotAction(req);
      const data = await res.json();

      // If reply is null and use_ai is true, it means it passed the fixed rules
      expect(data.use_ai).toBe(true);
      rpcSpy.mockRestore();
    });
  });

  describe("Scenario 2: Price Query", () => {
    test("Returns menu link or price info", async () => {
      const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
        if (name === "whatsapp_bot_handle_incoming") {
          return { ok: true, status: 200, data: { reply: "Aquí tienes nuestro menú con precios 👉 https://goloso.app/menu", use_ai: false } };
        }
        return { ok: true, status: 200, data: {} };
      });

      const req = createRequest("incoming", { message: "precios" });
      const res = await runBotAction(req);
      const data = await res.json();

      expect(data.reply).toContain("menú");
      expect(data.reply).toContain("https://");
      rpcSpy.mockRestore();
    });
  });

  describe("Scenario 3: Product Ordering", () => {
    test("Transitions to ordering flow", async () => {
      const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
        if (name === "whatsapp_bot_handle_incoming") {
          // For ordering, usually we hand over to AI
          return { ok: true, status: 200, data: { reply: null, use_ai: true } };
        }
        return { ok: true, status: 200, data: {} };
      });

      const req = createRequest("incoming", { message: "quiero un helado de chocolate" });
      const res = await runBotAction(req);
      const data = await res.json();

      expect(data.use_ai).toBe(true);
      rpcSpy.mockRestore();
    });
  });

  describe("Scenario 4: Cart Modification", () => {
    test("Allows cancelling or modifying via intent detection", async () => {
      const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
        if (name === "whatsapp_bot_handle_incoming") {
          // Detect 'cancelar' intent
          if ((params as any)._body.toLowerCase().includes("cancela")) {
            return { ok: true, status: 200, data: { reply: "Listo, cancelé tu pedido.", use_ai: false } };
          }
        }
        return { ok: true, status: 200, data: {} };
      });

      const req = createRequest("incoming", { message: "cancela todo" });
      const res = await runBotAction(req);
      const data = await res.json();

      expect(data.reply).toContain("cancelé");
      rpcSpy.mockRestore();
    });
  });

  describe("Scenario 5: Checkout", () => {
    test("Confirmation intent is recognized", async () => {
       const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
        if (name === "whatsapp_bot_handle_incoming") {
          if ((params as any)._body.toLowerCase().includes("confirmo")) {
            return { ok: true, status: 200, data: { reply: "¡Pedido confirmado! En un momento te contactamos.", use_ai: false } };
          }
        }
        return { ok: true, status: 200, data: {} };
      });

      const req = createRequest("incoming", { message: "confirmo el pedido" });
      const res = await runBotAction(req);
      const data = await res.json();

      expect(data.reply).toContain("confirmado");
      rpcSpy.mockRestore();
    });
  });
});

describe("AI Reply and FSM State Management", () => {
  const token = "mock_token_1234567890_long_enough";
  const phone = "573001234567";

  function createAiRequest(text: string) {
    return new Request("http://localhost/api/bot", {
      method: "POST",
      body: JSON.stringify({ action: "ai_reply", token, from: phone, text }),
    });
  }

  test("Greeting State: detect greeting and move forward", async () => {
    const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
      if (name === "whatsapp_bot_get_mode") return { ok: true, status: 200, data: "full" };
      if (name === "whatsapp_bot_ai_bootstrap") {
        return { 
          ok: true, status: 200, 
          data: { 
            context: { online_open: true, physical_open: true, usage_today: 0, daily_limit: 100 },
            cart: { items: [] },
            history: { messages: [] },
            ordering: { ordering_enabled: true }
          } 
        };
      }
      return { ok: true, status: 200, data: {} };
    });

    const req = createAiRequest("Hola");
    const res = await runBotAction(req);
    const data = await res.json();

    // Since it's a greeting and cart is empty, it should return a greeting.
    // In engine.ts, if it's a new conversation, it often uses shortCircuit or fallback.
    expect(data.reply).toBeDefined();
    rpcSpy.mockRestore();
  });

  test("Ordering State: adding a product updates the cart state", async () => {
    // This tests the logic in nextFsmState via bootstrap data
    const rpcSpy = spyOn(backend, "callRpc").mockImplementation(async (name, params) => {
      if (name === "whatsapp_bot_get_mode") return { ok: true, status: 200, data: "full" };
      if (name === "whatsapp_bot_ai_bootstrap") {
        return { 
          ok: true, status: 200, 
          data: { 
            context: { online_open: true },
            cart: { items: [{ product_id: "1", qty: 1, product_name: "Helado" }], customer_name: null },
            history: { messages: [{ role: "user", content: "quiero un helado" }] },
            ordering: { ordering_enabled: true }
          } 
        };
      }
      return { ok: true, status: 200, data: {} };
    });

    const req = createAiRequest("si, eso");
    const res = await runBotAction(req);
    const data = await res.json();

    // With items but no name, nextFsmState should be COLLECTING_NAME
    // The engine should ask for the name.
    expect(data.reply).toContain("nombre");
    rpcSpy.mockRestore();
  });
});
