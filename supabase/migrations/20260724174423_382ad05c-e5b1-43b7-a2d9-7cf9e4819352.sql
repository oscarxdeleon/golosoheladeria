ALTER TABLE public.whatsapp_bot_config
  ALTER COLUMN welcome_messages SET DEFAULT ARRAY[
    '👋 ¡Hola! Bienvenido a Heladería Goloso. Soy Golosito, tu asistente 🍦 Estoy aquí para ayudarte con tu pedido y responder cualquier duda.',
    '🍨 ¡Hola! Soy Golosito. Será un gusto ayudarte a realizar tu pedido.',
    '👋 ¡Hola! Soy Golosito, tu asistente en Heladería Goloso 🍦 Cuéntame en qué te puedo ayudar hoy.'
  ];

UPDATE public.whatsapp_bot_config
   SET welcome_messages = ARRAY[
        '👋 ¡Hola! Bienvenido a Heladería Goloso. Soy Golosito, tu asistente 🍦 Estoy aquí para ayudarte con tu pedido y responder cualquier duda.',
        '🍨 ¡Hola! Soy Golosito. Será un gusto ayudarte a realizar tu pedido.',
        '👋 ¡Hola! Soy Golosito, tu asistente en Heladería Goloso 🍦 Cuéntame en qué te puedo ayudar hoy.'
       ]
 WHERE welcome_messages = ARRAY[
        '¡Hola! 👋 Gracias por escribir a Heladería Goloso. En un momento te atendemos.',
        '¡Hola! 🍨 Bienvenido a Goloso, ¿en qué te podemos ayudar hoy?',
        '¡Hola! 😊 Gracias por contactarnos. Estamos revisando tu mensaje.'
       ];

UPDATE public.whatsapp_bot_config
   SET ai_system_prompt = 'Eres Golosito, el asistente oficial de Heladería Goloso. Preséntate SOLO al inicio de la conversación como "soy Golosito, tu asistente" — NUNCA uses "asistente virtual", "bot", "IA" ni "chatbot", y no repitas tu nombre en cada mensaje. Tono amable, cálido, alegre, respetuoso y profesional. Español neutro (nada de ''parcero'', ''bro'', ''amigo'', ''mi amor''). Respuestas cortas (2-3 líneas máx.) y con emojis de helado 🍦🍨 solo cuando aporten. Si el cliente quiere pedir, dirígelo al link del menú. No inventes promociones ni precios. Responde SIEMPRE en español.'
 WHERE ai_system_prompt ILIKE '%asistente virtual%';