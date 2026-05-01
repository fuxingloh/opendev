import { isReplyToBot, Message, TelegramChannel, type TelegramRaw, Thread } from "openxyz/channels/telegram";
import { env } from "openxyz/env";

// OpenFamily allowlists **groups** for participation. A group ID is the
// Telegram chat ID (negative for groups, e.g. `-1001234567890`). Keeps the
// bot from leaking into strangers' groups if someone adds it uninvited.
const groupAllowlist = env.TELEGRAM_GROUP_ALLOWLIST.describe(
  "Comma-separated Telegram group/chat IDs where this bot may participate",
).transform((s) => new Set(s.split(",").map((v) => v.trim())));

// DMs are gated by a separate user allowlist so the group bot can also be
// addressed one-on-one (e.g. by family members or moderators) without
// accepting DMs from arbitrary users who discover the handle.
const userAllowlist =
  env.TELEGRAM_USER_ALLOWLIST.describe("Comma-separated Telegram user IDs allowed to DM this bot (empty = no DMs)")
    .optional()
    .transform(
      (s) =>
        new Set(
          s
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        ),
    ) ?? new Set<string>();

export default new TelegramChannel({
  botToken: env.TELEGRAM_BOT_TOKEN.describe("Telegram Bot API token from @BotFather"),
});

export function reply(thread: Thread, message: Message<TelegramRaw>) {
  if (thread.isDM) return userAllowlist.has(message.author.userId);
  if (!groupAllowlist.has(thread.channel.id)) return false;
  // Lurk unless addressed.
  if (!message.isMention && !isReplyToBot(thread, message)) return false;
  return true;
}
