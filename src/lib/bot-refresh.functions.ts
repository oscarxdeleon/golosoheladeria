import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { synchronizeChatbot } from "@/lib/bot-refresh.server";
import type { ChatbotRefreshResult } from "@/lib/bot-refresh.server";

export type { ChatbotRefreshResult } from "@/lib/bot-refresh.server";

export const refreshChatbot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChatbotRefreshResult> => {
    return synchronizeChatbot(context.supabase);
  });
