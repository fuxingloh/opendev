# OpenBrain

A **brain** you can talk to — for a person or for a company. Send it thoughts, decisions, URLs, quotes, meeting notes, reasoning traces; it captures, organizes, and retrieves them over time. Structured, current, actionable knowledge that you (and your AI agents) can execute against.

YC RFS #4 calls this shape "the Company Brain." OpenBrain is the same idea, scaled down to fit one person and scaled up to fit a small team. The moat is the **reasoning layer** — the decision traces that live in your AI conversations and would otherwise vanish.

## What it does

- **Capture** — send it a fragment (voice-of-thought, URL, PDF, quote, decision, meeting note), it saves it to the brain and confirms where it landed
- **Organize** — groups related notes, adds cross-links, proposes structure when a pattern emerges
- **Retrieve** — ask "what did I say about X last month", "what did we decide on the pricing thread", "pull up the article on Y" — it finds it
- **Summarize** — daily/weekly roll-ups, topic digests, reading queues, decision logs

The agent's home directory _is_ the brain. Markdown files, light YAML frontmatter, flat structure + tags. Nothing exotic — your notes stay human-readable even if you stop using the agent.

## Who it's for

- **Individuals** who want an always-on, chat-accessible notebook that captures the "I just thought of something" fragments other tools lose.
- **Small teams / companies** who want a shared brain — decisions, context, reasoning traces — that AI agents and humans can both query.

The shape is the same in both cases: a markdown directory + an agent that knows how to navigate it. Allowlists decide who's writing into the brain.

Works in DMs or group chats:

- **DM**: anyone on the allowlist can talk to it. For a personal brain, that's just you (or you + a partner). For a company brain, that's the team.
- **Group**: the bot lurks; only responds when an allowlisted user @-mentions it or replies to one of its messages. Even then, context is filtered to _only_ allowlisted users' messages + the bot's own replies — other group members' chatter is ignored entirely. The brain stays scoped to your team, even when the bot sits in a shared chat.

If you want a bot that actively participates in group conversations (not scoped to one user/team), see `templates/openfamily`.

## Setup

1. Edit `.env.local`:
   - `TELEGRAM_BOT_TOKEN` — get one from [@BotFather](https://t.me/BotFather)
   - `TELEGRAM_ALLOWLIST` — Telegram user IDs allowed to read/write the brain (comma-separated). For a personal brain, just yours. For a team brain, everyone on the team. Only users in this list can trigger replies _or_ contribute to context.
   - `OPENXYZ_MODEL` — e.g. `bedrock/zai.glm-5`, `openai/gpt-5`; plus any provider credentials the model needs
2. From the repo root: `bun install`
3. Run it: `cd templates/openbrain && bun start`

If you want to use it in a group chat, also **disable privacy mode** in @BotFather (`/setprivacy` → Disable) so the bot can see all messages in the group. The allowlist still restricts what it actually reads and responds to.

## Deploy to Vercel

`bun run build` produces `.vercel/output/`. Deploy with the Vercel CLI or a git-connected project, set the same env vars in the Vercel dashboard, and point Telegram's webhook at `https://<deployment>/api/webhooks/telegram`.

## Making it yours

- **Add tools** — drop a `tools/*.ts` file exporting an AI SDK tool and the agent picks it up. Useful for integrating calendars, bookmark services, transcription, etc.
- **Add skills** — drop a `skills/<name>/SKILL.md` with a frontmatter `name`/`description` and a body prompt. The agent loads the skill on demand.
- **Tune the persona** — edit `AGENTS.md` to shift tone (more terse, more chatty, more structured, more tag-driven).

## Layout

```
openbrain/
├── AGENTS.md              # the persona prompt
├── channels/telegram.ts   # Telegram adapter + allowlist
└── package.json
```
