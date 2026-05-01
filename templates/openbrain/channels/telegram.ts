import { isReplyToBot, Message, TelegramChannel, type TelegramRaw, Thread } from "openxyz/channels/telegram";
import { env } from "openxyz/env";

const allowlist = env.TELEGRAM_ALLOWLIST.describe(
  "Comma-separated Telegram user IDs this brain serves (one person, or a small team)",
).transform((s) => new Set(s.split(",").map((v) => v.trim())));

export default new TelegramChannel({
  botToken: env.TELEGRAM_BOT_TOKEN.describe("Telegram Bot API token from @BotFather"),
});

/**
 * Decides which messages enter the thread history at all. Bot's own messages
 * must pass so the agent sees its prior turns; everyone else is allowlist-gated.
 */
export function filter(message: Message<TelegramRaw>, thread: Thread) {
  const botUserId = (thread.adapter as { botUserId?: string }).botUserId;
  if (botUserId && message.author.userId === botUserId) return true;
  return allowlist.has(message.author.userId);
}

/**
 * DMs always reply; in groups only on `@mention` or reply-to-bot, to avoid
 * hijacking unrelated chatter.
 */
export async function reply(thread: Thread, message: Message<TelegramRaw>) {
  if (!allowlist.has(message.author.userId)) return false;
  if (thread.isDM) return true;
  if (!message.isMention && !isReplyToBot(thread, message)) return false;
  return true;
}
