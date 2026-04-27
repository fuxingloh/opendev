# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Internal scratchpad, open work, design history, and mnemonic cross-references live in `../../@openxyz-app/mnemonic/000-AGENTS.md` (a sibling repo). Read that first if you want the full context behind decisions; this file is the public-facing project guide.

## Mnemonic cross-references

> "Mind-Palace"

Mnemonic notes live in a **separate sibling repo** at `../../@openxyz-app/mnemonic/` (github.com:openxyz-app/mnemonic.git). Read, edit, and reference them via that relative path.

@../../@openxyz-app/mnemonic/000-AGENTS.md

You MUST ALWAYS look at `../../@openxyz-app/mnemonic/*` when writing a new feature or bugfix.

**Whenever you create or edit a mnemonic note, commit and push it before moving on:**

```
git -C ../../@openxyz-app/mnemonic add -A && \
  git -C ../../@openxyz-app/mnemonic commit -m "<short msg>" && \
  git -C ../../@openxyz-app/mnemonic push
```

The mnemonic repo is its own git repo — changes do **not** propagate through the openxyz repo's commit flow.

## External references

- **Linear** — issues use the `OXYZ-*` prefix (team `openxyz`). Use the `linear-server` MCP tools to look up, update, or create issues when the user mentions an `OXYZ-nn` identifier.

## What OpenXyz is

OpenXyz is an AI agent harness for human workflows — **not** a coding tool. A platform for building personal assistants (chief-of-staff, janitor, researcher) that a user talks to through multiple channels (Telegram, terminal, more later) backed by one shared AI agent session. The AI lives in a virtual filesystem it can self-modify (write its own tools, skills, agents, channels).

**Core goal:** `openxyz start` runs a single process where a user talks to one agent across a TUI and chat channels, with custom tools/skills/agents discovered from the template directory.

The reference template is `templates/openxyz-janitor` — the team's own chief-of-staff, dogfooded.

## Reference source (read these when the question touches them)

- `../ai` — the `ai` SDK monorepo we depend on. Source for `ToolLoopAgent`, `wrapLanguageModel`, `convertToLanguageModelPrompt`, `streamText`, middleware spec, per-provider packages (`../ai/packages/{ai,anthropic,amazon-bedrock,openai,openai-compatible,gateway,...}`). Go here when you need exact types, marker shapes, or call semantics.
- `../chat` — the chat-sdk monorepo. Source for `Chat`, `Thread`, `Adapter`, `toAiMessages`, `@chat-adapter/*`. Go here for dispatch tiering, thread lifecycle, webhook decoding, state adapter contracts.
- Full reference checkouts table lives in `../../@openxyz-app/mnemonic/000-AGENTS.md`.

## Tech direction

OpenXyz is **Vercel AI SDK-native**. All tool, agent, streaming, and model primitives come from `ai` (v6) and the `@ai-sdk/*` provider packages. `openxyz/tools` re-exports `tool` from `ai` and `z` from `zod`. No `@opencode-ai/*` or `opencode-ai` runtime dependency.

```ts
// templates/*/tools/echo.ts
import { tool, z } from "openxyz/tools";

export default tool({
  description: "...",
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => `"${text}"`,
});
```

Default to AI Gateway model strings (`provider/model`) over direct provider SDK wiring where possible.

## Monorepo layout

- **Root** (`package.json`): Bun workspaces (`packages/*`, `templates/*`) via the `workspaces` field, Turborepo, shared Prettier config (120-char width, `prettier-plugin-packagejson`). Package manager and runtime is **Bun** (not npm/pnpm/yarn). No `engines.node` pin.
- **`packages/openxyz`**: the publishable **CLI + thin facade** that templates (downstream users) depend on. Owns the `openxyz` bin and the re-export surface (`openxyz/tools`, `openxyz/channels/*`, `openxyz/drives/*`, `openxyz/env`). ESM-only. **No build step** — Bun runs TypeScript natively. `bin.openxyz` in `package.json` points directly at `bin/bin.ts` (`#!/usr/bin/env bun`). Subpath exports point at source (`./channels/telegram.ts`) — consumers need Bun. Peer-deps `ai@^6` and `@ai-sdk/provider@^3`. Keep this package small — real work lives in `@openxyz/runtime` and the vendor packages.
- **`packages/openxyz-runtime`** (`@openxyz/runtime`): the **engine**. Agent loop (`openxyz.ts`), tool registry/discovery, VFS (`just-bash` + `MountableFs`), `Drive` interface + `WorkspaceDrive`, reusable FS adapters (`fs/ignored.ts`, `fs/readonly.ts`), `Channel` abstract class, session store, streaming. Scoped package, internal to the openxyz family. Bare engine — ships no default agents, no default models, no default drives beyond `WorkspaceDrive`. Templates do **not** import from here directly — they import from `openxyz`, which re-exports whatever runtime surface the template needs.
- **Vendor packages** (`@openxyz-provider/<vendor>` ↔ `packages/openxyz-provider-<vendor>/`): one package per external integration (Telegram, GitHub, Google, Notion, ...). Vendor integrations live under a separate `@openxyz-provider/*` npm scope; core packages (runtime, auth, facade) stay under `@openxyz/*`. Subpath exports by kind: `@openxyz-provider/telegram/channel`, `@openxyz-provider/github/drive`, etc. A vendor can ship any mix of `/channel`, `/drive`, `/tools`, `/model`, `/auth` as its surface. Popular vendors (Telegram currently) get re-exported via `openxyz/channels/<vendor>` + `openxyz/drives/<vendor>` so templates don't need an extra install; less-popular ones users add explicitly. Naming convention and rationale in `mnemonic/075`.
- **Templates** (`templates/<name>/`): reference projects. `openxyz-janitor` is the dogfood chief-of-staff. `pkbm-agent` and `group-agent` exercise other shapes. Each template depends on `openxyz: workspace:*`.
- **Turborepo** (`turbo.json`): `build`, `test`, `clean`, `dev` tasks. `packages/openxyz` has no build script (runs source). Templates use `build: openxyz build` which codegens a Vercel function bundle into `.vercel/output/`. Filter via `bun run build --filter='./templates/*'` or `--filter=<template-name>`.

## Commands

```bash
bun install                                # Install dependencies
bun run test                               # Run all tests (turbo)
bun run format                             # Format all files with Prettier
bun x prettier --check .                   # Check formatting without writing

# Template builds via turbo filter (no cd needed)
bun run build --filter='./templates/*'     # Build every template's .vercel/output
bun run build --filter=openxyz-janitor     # Build a single template
```

Run a template's dev loop with `bun --filter=<template-name> start` (or `cd templates/<name> && bun start` if the user's shell permissions allow `cd`).

## Architecture

### Template convention

A template is a project directory the user runs `openxyz start` from. Filename = identity (`channels/telegram.ts` → channel type `telegram` with sessions `telegram:<user-id>`; `tools/echo.ts` → tool id `echo`).

```
my-template/
├── package.json              # deps: openxyz + vendor packages (@openxyz-provider/telegram, @openxyz-provider/github, ...)
├── AGENTS.md                 # project-specific instructions for the AI
├── .env.local                # TELEGRAM_BOT_TOKEN, GITHUB_TOKEN, etc.
├── channels/                 # transport adapters (telegram, slack, ...) — mount sessions
│   └── telegram.ts           # export default new TelegramChannel({ ... })
├── tools/                    # custom AI tools (AI SDK `tool()` shape)
│   └── echo.ts               # default export = tool({ description, inputSchema, execute })
├── drives/                   # external filesystems mounted at /mnt/<name>/ (optional)
│   └── my-repo.ts            # export default new GitHubDrive({ owner, repo, token, permission })
├── skills/                   # custom skills (optional)
│   └── my-skill/SKILL.md
├── agents/                   # custom agents (optional)
└── models/                   # custom model providers (optional; falls back to openxyz's `auto.ts`)
```

Filename = identity:

- `channels/telegram.ts` → channel type `telegram`, sessions `telegram:<user-id>`
- `tools/echo.ts` → tool id `echo`
- `drives/my-repo.ts` → drive mounted at `/mnt/my-repo/`
- `agents/researcher.md` → agent id `researcher`

### Terminology (important — don't mix up)

- **Template** = project directory with the conventions above
- **Runtime** = `@openxyz/runtime` — the bare engine (agent loop, VFS, drive/channel interfaces, session store). Historical docs/mnemonic entries may call this "harness"; new work uses "runtime".
- **Facade** = `openxyz` — the CLI (`openxyz build`/`openxyz start`) + re-export surface templates import from.
- **Vendor package** = `@openxyz-provider/<vendor>` — external integration (Telegram, GitHub, Google, ...). Subpaths: `/channel`, `/drive`, `/tools`, `/model`, `/auth`. Lives under a separate npm scope from core `@openxyz/*` packages.
- **Channel** = transport type (telegram, slack, terminal) — lives in `channels/`. A channel is the parent container.
- **Session** = one conversation context, child of a channel. One channel contains many sessions. Naming: `<channel>:<id>`, e.g. `telegram:7601560926`.
- **Drive** = a mounted filesystem with optional `refresh()`/`commit()` lifecycle hooks. `WorkspaceDrive` at `/workspace` is always mounted; templates can add drives under `/mnt/<name>/` via `drives/<name>.ts`.
- **VFS** = the agent's filesystem (`/workspace/` + `/mnt/*`). Never describe it as "virtual" in AI-facing tool descriptions.

## Patterns to learn from

- **Namespace pattern** — `export namespace X { ... }` per domain
- **Zod + `z.infer` pairs** for every exported schema; `.describe()` every field the LLM sees
- **Typed IDs** — `Identifier.ascending("session")` → `ses_<ulid>`
- **`.txt` prompt files** with `${placeholder}` substitution
- **Small utility helpers** — `defer`, `iife`, `lazy`, `isRecord`, `fn`
- **Structured logging** — `Log.create({ service })`, `using _ = log.time(...)`
- **`NamedError` types** per domain with cause chains
- **`@/` path alias** for internal imports
- **Tool wrapper pattern** — auto validation + output truncation around the AI SDK `tool()` primitive

## Agentic loop

Reliable AI agent loops built on AI SDK `streamText()`. Essentials:

1. Loop termination requires multiple signals (finish reason + no pending tools + user/assistant ordering)
2. Stream events and persist to DB atomically — crash-recoverable
3. **Tool errors continue the loop, LLM errors break it**
4. Retry needs `Retry-After` header parsing (AI SDK's `maxRetries` isn't smart enough)
5. Fire-and-forget chat-sdk handlers (sync awaits cause LockError)
6. `AbortController` propagation to both `streamText()` and tools
7. Cost tracking with Decimal.js (float errors compound)
8. **Skip context compaction for v1** — modern 200k+ windows rarely hit limits

## Known gotchas

1. `child_process.spawnSync` + `stdio: "inherit"` is unreliable for nested Bun processes — TTY handoff fails. Use `Bun.spawn` with the exact dev command.
2. Do not import `chat` under `--conditions=browser` — transitive deps touch `document`.
3. chat-sdk thread handlers must be fire-and-forget. Holding the lock across `await` causes `LockError` on concurrent messages.
4. Telegram markdown posts need a plain-text fallback — the parser rejects some outputs.
5. `MountableFs` options shape is `{ mounts: [{ mountPoint, filesystem }] }`, not `{ mounts: { path: fs } }`.
6. `OverlayFs` writes are **copy-on-write / in-memory** — they don't hit the underlying disk. For writable drives whose edits must be visible to a downstream process (git, archiver, sync daemon), use `ReadWriteFs`. See mnemonic/077.
7. `MountableFs` strips the `mountPoint` before forwarding to the inner FS — keys in `InMemoryFs` must be relative to mount root (`/AGENTS.md`), not absolute VFS paths (`/workspace/AGENTS.md`). See mnemonic/072.
8. `@vercel/functions.waitUntil` is broken on Vercel's Bun runtime (short grace period, not full lifetime extension). Inline `Promise.allSettled(tasks)` before the response as the working fallback. See mnemonic/069–070.

## Code style

From `AGENTS.md`:

- **Single-word variable names** — `cfg` not `config`, `pid` not `inputPID`, `err` not `existingError`
- **No `try/catch`** where possible
- **No `any`** type
- **Avoid `let`** — ternaries and early returns instead
- **Early returns over else blocks**
- **Dot notation over destructuring** when single use
- **Functional array methods** (flatMap/filter/map) over for loops
- **snake_case** for Drizzle schema fields (no column name strings needed)
- **Type inference over explicit annotations**

### Comments: WHY, not WHAT

Default to no comments. Write one only when the reader can't recover the reasoning from the code alone. Specifically:

- **Framework/library contracts that aren't visible at the call site** — chat-sdk's tiered dispatch (`onDirectMessage` → `onSubscribedMessage` → `onNewMention` → `onNewMessage` with early returns), AI SDK's `stopWhen` semantics, Telegram's forum-topic thread IDs, prompt cache-control ordering. If the "why" lives in another repo, mention it.
- **Non-obvious ordering, fan-out, or sequencing** — why we auto-`thread.subscribe()` inside `onNewMention`, why `environment` prepends to `context()` instead of merging, why a handler is fire-and-forget instead of awaited.
- **Surprising upstream limits** — `thread.refresh()` caps at 50 (thread.ts:726); `fetchChannelMessages` is cache-backed on Telegram; chat-sdk's `isMention` is set by dispatcher, preserved if already truthy.

Never comment what the code already says. `// increment counter` above `i++` adds noise. `// Telegram's adapter.fetchChannelMessages is cache-backed — messages before process start won't appear` adds load-bearing context.

When in doubt, ask: "could a future maintainer reconstruct this reasoning from a clean read of the code?" If yes, skip the comment. If no, write it — and keep it tight.

## Testing

Write tests as you implement features. Not after. Not "if there's time." If the logic is non-trivial — a new class, a state machine, a parser, a slicing helper, anything with invariants a future refactor could silently break — it ships with a test file.

- Co-locate tests in `*.test.ts` next to the source they exercise.
- Use `bun:test` — `describe` / `test` / `expect`. No jest, no separate runner.
- Run with `bun run test` (turbo, whole repo) or `bun test <path>` (single file, fast iteration).

**Cover invariants, not lines.** The test should describe a property the code must uphold — "never orphans a tool-result", "fails open on downstream error", "is idempotent on re-entry" — and fail the day someone breaks it. Coverage percentage isn't the goal; catching regressions in load-bearing contracts is.

**One invariant per `test("…")`.** The test name describes the property, not the mechanics ("rejects on expired token", not "calls verify() then throws"). Arrange shared helpers at the top of the file.

**Prefer testing at module boundaries** — public functions, exported classes, pure helpers. For module-private helpers worth testing directly, export them with a `// Exported for testing — treat as internal.` doc line rather than inventing a parallel test seam.

**For AI SDK / chat-sdk / external integration points**, mock at the narrowest interface you can (e.g. `MockLanguageModelV3.doGenerate` over full stream mocking). Heavy mocks are a smell — they usually mean the seam is wrong. If the setup balloons, consider whether the unit under test should be smaller.

When you can't reasonably test something (streaming integration, cross-process coordination, external APIs), say so in the PR — don't pretend it's covered. Write a followup task instead.

## Working style

- Terse, direct responses — no preamble, **no emojis**
- Give reasoning and tradeoffs, not recipes
- "simpler" and "smaller" are strong signals — prefer those paths
- Match the level of the question (architecture, specific line, or anywhere in between)
- When debugging, ask for actual command output rather than guessing

## Publishing

Packages are published to npm via GitHub Releases. Version is extracted from the git tag (`v1.0.0` format). Prerelease tags (e.g. `v1.0.0-beta.1`) publish under the `next` dist-tag. Workspace dependency references (`workspace:*`) are resolved to the release version at publish time. Publishing uses npm provenance with OIDC.

## Pre-commit

Husky runs `lint-staged` on commit, which applies `prettier --write --ignore-unknown` to all staged files.
Not something you need to worry about.

## Key conventions

- Package manager and runtime is **Bun** (not npm/pnpm/yarn). Always use `bun` to run scripts, install deps, and execute the CLI.
- **TypeScript 6**. `@types/bun` (not `@types/node`). `tsconfig.json` has `types: ["bun"]`.
- Prefer **Bun-native APIs** over Node equivalents: `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.env`, `Bun.serve`, `new Glob()`. Bun auto-loads `.env.local` — no `dotenv`/`@next/env` needed.
- All packages use `"version": "0.0.0"` in source; real versions are set during CI publish.
- All packages use `"type": "module"` (ESM-only).
- **Never describe the filesystem as "virtual" in AI-facing tool descriptions** — the AI should think it's a normal filesystem.
