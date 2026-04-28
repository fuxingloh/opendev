import { isReplyToBot, Message, TelegramChannel, type TelegramRaw, Thread } from "openxyz/channels/telegram";
import { readEnv, z } from "openxyz/env";

const allowlist = readEnv("TELEGRAM_ALLOWLIST", {
  description: "Comma-separated Telegram user IDs this brain serves (one person, or a small team)",
  schema: z.string().transform((s) => new Set(s.split(",").map((v) => v.trim()))),
});

export default new TelegramChannel({
  botToken: readEnv("TELEGRAM_BOT_TOKEN", {
    description: "Telegram Bot API token from @BotFather",
  }),
});

export function filter(message: Message<TelegramRaw>, thread: Thread) {
  const botUserId = (thread.adapter as { botUserId?: string }).botUserId;
  if (botUserId && message.author.userId === botUserId) return true;
  return allowlist.has(message.author.userId);
}

export async function reply(thread: Thread, message: Message<TelegramRaw>) {
  if (!allowlist.has(message.author.userId)) return false;
  if (thread.isDM) return true;
  if (!message.isMention && !isReplyToBot(thread, message)) return false;
  return true;
}
