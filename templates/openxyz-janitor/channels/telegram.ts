import { telegram, type MessageContext } from "openxyz/channels/telegram";
import { readEnv, z } from "openxyz/env";

export default telegram({
  botToken: readEnv("TELEGRAM_BOT_TOKEN", {
    description: "Telegram Bot API token from @BotFather",
  }),
});

const allowlist = readEnv("TELEGRAM_ALLOWLIST", {
  description: "Comma-separated Telegram user IDs allowed to interact",
  schema: z.string().transform((s) => new Set(s.split(",").map((v) => v.trim()))),
});

export function shouldRespond({ message }: MessageContext): boolean {
  return allowlist.has(message.author.userId);
}
