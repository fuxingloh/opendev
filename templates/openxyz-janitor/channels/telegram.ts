import { telegram } from "openxyz/channels/telegram";
import { readEnv, z } from "openxyz/env";

export default telegram({
  botToken: readEnv("TELEGRAM_BOT_TOKEN", {
    description: "Telegram Bot API token from @BotFather",
  }),
});

export const allowlist = readEnv("TELEGRAM_ALLOWLIST", {
  description: "Comma-separated Telegram user IDs allowed to interact",
  schema: z.string().transform((s) => s.split(",").map((v) => v.trim())),
});
