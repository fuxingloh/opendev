import { isReplyToBot, Message, TelegramChannel, type TelegramRaw, Thread } from "openxyz/channels/telegram";
import { env, z } from "openxyz/env";

// OpenFamily allowlists **groups** for participation. A group ID is the
// Telegram chat ID (negative for groups, e.g. `-1001234567890`). Keeps the
// bot from leaking into strangers' groups if someone adds it uninvited.
const groupAllowlist = env.TELEGRAM_GROUP_ALLOWLIST.describe(
  "Comma-separated Telegram group/chat IDs where this bot may participate",
).pipe(
  z
    .string()
    .transform(
      (s) =>
        new Set(
          s
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        ),
    )
    .refine((set) => set.size > 0, "must contain at least one group ID"),
);

// DMs are gated by a separate user allowlist so the group bot can also be
// addressed one-on-one (e.g. by family members or moderators) without
// accepting DMs from arbitrary users who discover the handle.
const userAllowlist = env.TELEGRAM_USER_ALLOWLIST.describe(
  "Comma-separated Telegram user IDs allowed to DM this bot (empty = no DMs)",
)
  .default("")
  .transform(
    (s) =>
      new Set(
        s
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
  );

export default new TelegramChannel({
  botToken: env.TELEGRAM_BOT_TOKEN.describe("Telegram Bot API token from @BotFather"),
});

export function reply(thread: Thread, message: Message<TelegramRaw>) {
  if (thread.isDM) return userAllowlist.has(message.author.userId);
  // `thread.channel.id` / `thread.channelId` are chat-sdk's `telegram:<chatId>`
  // form (see `../chat/packages/adapter-telegram/src/index.ts:1009`); the env
  // allowlist holds the bare Telegram chat IDs users see in the app, so go
  // through `message.raw.chat.id` to compare apples-to-apples.
  if (!groupAllowlist.has(String(message.raw.chat.id))) return false;
  // Lurk unless addressed.
  if (!message.isMention && !isReplyToBot(thread, message)) return false;
  return true;
}
