import { telegram } from "openxyz/channels";
import { readEnv } from "openxyz/env";
import { z } from "openxyz/zod";

export default telegram({
  botToken: readEnv("TELEGRAM_BOT_TOKEN", {
    description: "Telegram Bot API token from @BotFather",
    schema: z.string(),
  }),
});

export const allowlist = readEnv("TELEGRAM_ALLOWLIST", {
  description: "Comma-separated Telegram user IDs allowed to interact",
  schema: z.string().transform((s) => s.split(",").map((v) => v.trim())),
});
