# OpenXyz

An AI agent harness for human workflows — not a coding tool.

Build personal assistants (chief-of-staff, janitor, researcher) you talk to across multiple channels (Telegram, terminal, more) backed by one shared agent session. The agent lives in a filesystem it can self-modify — writing its own tools, skills, agents, and channel adapters.

## Quick start

```bash
bun install
bun --filter=openxyz-janitor start
```

`openxyz start` runs a single process: a TUI plus any channels the template declares, all dispatching into one agent loop.

## Layout

- `packages/openxyz` — publishable CLI + thin facade. Exposes `openxyz/tools`, `openxyz/channels/<vendor>`, `openxyz/drives/<vendor>`, `openxyz/env`. No build step; templates run source via Bun.
- `packages/openxyz-runtime` (`@openxyz/runtime`) — the engine: agent loop, tool registry, VFS (`/workspace` + `/mnt/*`), `Drive` and `Channel` interfaces, session store, streaming.
- `packages/openxyz-provider-*` (`@openxyz-provider/<vendor>`) — vendor integrations (Telegram, GitHub, Google, ...). Each ships any mix of `/channel`, `/drive`, `/tools`, `/model`, `/auth`.
- `packages/openxyz-auth` — auth primitives.
- `templates/openxyz-janitor` — reference template, dogfooded as the team's chief-of-staff. Other templates: `pkbm-agent`, `group-agent`.

## Template shape

A template is a project directory you run `openxyz start` from. Filename is identity — `tools/echo.ts` → tool id `echo`, `channels/telegram.ts` → sessions `telegram:<user-id>`.

```
my-template/
├── package.json       # deps: openxyz + @openxyz-provider/*
├── AGENTS.md          # instructions the agent reads
├── .env.local
├── channels/          # transport adapters: telegram.ts, ...
├── tools/             # custom AI SDK tools
├── drives/            # filesystems mounted at /mnt/<name>/
├── skills/            # optional SKILL.md bundles
├── agents/            # optional subagents
└── models/            # optional model providers
```

## Commands

```bash
bun run test                            # all tests (turbo)
bun run format                          # prettier --write
bun run build --filter='./templates/*'  # codegen .vercel/output for each template
bun --filter=<template> start           # run a template
```

## Stack

Bun · TypeScript 6 · Vercel AI SDK v6 · chat-sdk · Turborepo

See [`CLAUDE.md`](./CLAUDE.md) for architecture and conventions.
