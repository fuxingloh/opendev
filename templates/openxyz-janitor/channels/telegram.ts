import { telegram } from "openxyz/channels";
import { readEnv } from "openxyz/env";
import { z } from "openxyz/zod";

export default telegram({
  botToken: readEnv("TELEGRAM_BOT_TOKEN", {
    description: "Telegram Bot API token from @BotFather",
    type: z.string(),
  }),
});

export const allowlist = readEnv("TELEGRAM_ALLOWLIST", {
  description: "Comma-separated Telegram user IDs allowed to interact",
  type: z.string().transform((s) => s.split(",").map((v) => v.trim())),
});
