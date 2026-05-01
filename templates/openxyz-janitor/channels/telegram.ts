import { isReplyToBot, Message, TelegramChannel, type TelegramRaw, Thread } from "openxyz/channels/telegram";
import { env } from "openxyz/env";

const allowlist = env.TELEGRAM_ALLOWLIST.describe("Comma-separated Telegram user IDs allowed to interact").transform(
  (s) => new Set(s.split(",").map((v) => v.trim())),
);

export default new TelegramChannel({
  botToken: env.TELEGRAM_BOT_TOKEN.describe("Telegram Bot API token from @BotFather"),
});

export function reply(thread: Thread, message: Message<TelegramRaw>) {
  if (!allowlist.has(message.author.userId)) return false;
  // In groups, only respond when addressed — @-mentioned or replying to the bot.
  if (!thread.isDM && !message.isMention && !isReplyToBot(thread, message)) return false;
  return true;
}
