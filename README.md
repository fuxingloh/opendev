# OpenXyz

An AI agent harness for human workflows — not a coding tool.

Build personal assistants (chief-of-staff, janitor, researcher) that talk to you across multiple channels (Telegram, terminal, more) backed by one shared agent session. The agent lives in a filesystem it can self-modify: its own tools, skills, agents, and channels.

## Quick start

```bash
cd templates/openxyz-janitor
bun install
bun start
```

## Layout

- `packages/openxyz` — CLI + thin facade (`openxyz/tools`, `openxyz/channels`)
- `packages/openxyz-harness` — engine (agent loop, tools, VFS, channel bridge)
- `templates/openxyz-janitor` — reference template, dogfooded as our chief-of-staff

## Template shape

```
my-template/
├── package.json       # deps: openxyz + adapters
├── AGENTS.md          # instructions for the agent
├── .env.local
├── channels/          # telegram.ts, slack.ts, ...
├── tools/             # custom AI SDK tools
├── skills/            # optional SKILL.md bundles
└── agents/            # optional subagents
```

## Stack

Bun · TypeScript · Vercel AI SDK v6 · chat-sdk

See [`CLAUDE.md`](./CLAUDE.md) for architecture and conventions.
