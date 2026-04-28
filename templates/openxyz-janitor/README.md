# openxyz-janitor

The dogfood template. A strategy-focused Chief of Staff that the OpenXyz team uses to decide **what to build next**, and the canonical reference when you're figuring out "how does a template actually look?"

## What it does

- **Shapes the roadmap** — helps the team pick the next thing to build based on user value, competitive pressure, and what's actually getting used
- **Scouts the landscape** — browses the web, reads docs, skims repos, compares approaches. Answers "what are other people doing about X?"
- **Tracks ecosystem moves** — new releases from AI SDK, chat-sdk, adapters, competing harnesses. Flags what matters and why.
- **Weighs trade-offs** — lays out the assumptions behind two directions, not just the options

It does _not_ write code, manage tickets, or run standups. Those belong to the team (and their coding agents).

DM-only personal assistant. Not designed for group chats. If you want a group-chat bot, see `templates/openfamily`. If you want a general personal knowledge base, see `templates/openbrain`.

## Who it's for

The OpenXyz team. It's a reference implementation — fork it if you want a personal chief-of-staff tailored to your own project, but expect some of the defaults to be specific to this repo (e.g., the `mnemonic` design-history convention, kept in a separate sibling repo).

## Setup

1. Copy `.env.local.example` → `.env.local` (or edit `.env.local` directly) and fill in:
   - `TELEGRAM_BOT_TOKEN` — get one from [@BotFather](https://t.me/BotFather)
   - `TELEGRAM_ALLOWLIST` — comma-separated Telegram user IDs allowed to talk to the bot
   - `OPENXYZ_MODEL` — model string (e.g. `bedrock/zai.glm-5`, `openai/gpt-5`); any provider credentials required by that model also go here
2. From the repo root: `bun install`
3. Run it: `cd templates/openxyz-janitor && bun start`

## Deploy to Vercel

`bun run build` produces `.vercel/output/`. Deploy it with the Vercel CLI or via a git-connected project. Set the same env vars in the Vercel dashboard. Point Telegram's webhook at `https://<deployment>/api/webhooks/telegram`.

## Layout

```
openxyz-janitor/
├── AGENTS.md              # the persona prompt
├── channels/telegram.ts   # Telegram adapter + reply gate
├── tools/echo.ts          # example custom tool
├── skills/                # PRD generator, humanizer skills
└── package.json
```
