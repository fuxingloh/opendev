# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenXyz is a TypeScript monorepo managed with pnpm and Turborepo. The primary package (`packages/openxyz`) is an npm-published CLI and library that peer-depends on Vercel AI SDK v6 (`ai@^6`, `@ai-sdk/provider@^3`). It targets Node.js (>=24.0.0).

## Commands

```bash
pnpm install              # Install dependencies
pnpm run build            # Build all packages (turbo)
pnpm run test             # Run all tests (turbo)
pnpm run lint             # Lint all packages with --fix (turbo)
pnpm run format           # Format all files with Prettier
pnpm prettier --check .   # Check formatting without writing
```

To run a single package task:

```bash
pnpm turbo run build --filter=openxyz
pnpm turbo run test --filter=openxyz
```

## Architecture

- **Monorepo root** (`package.json`): pnpm workspaces (`packages/*`), Turborepo orchestration, shared Prettier config (120 char width, `prettier-plugin-packagejson`).
- **`packages/openxyz`**: The main publishable package. ESM-only (`"type": "module"`). Built with **tsdown** (Rolldown-powered bundler, `dts: true` for type declarations) — source is TypeScript, output is `dist/` (`.mjs` + `.d.mts`). Has a `bin.js` CLI entry point (`#!/usr/bin/env node`) that imports the compiled `dist/bin.mjs`. Subpath exports (e.g., `openxyz/tools`) are defined in `package.json` `exports` with both `types` and `import` conditions. When adding a new public module, add it to both `tsdown.config.ts` entry and `package.json` exports.
- **Turborepo** (`turbo.json`): Tasks are `build`, `test`, `lint`, `clean`, `dev`. Build inputs are `tsconfig.json`, `openxyz.config.ts`, `src/`, `app/`; outputs are `dist/`, `.vercel/output`.

## Publishing

Packages are published to npm via GitHub Releases. Version is extracted from the git tag (`v1.0.0` format). Prerelease tags (e.g., `v1.0.0-beta.1`) publish under the `next` dist-tag. Workspace dependency references (`workspace:*`) are resolved to the release version at publish time. Publishing uses npm provenance with OIDC.

## Pre-commit

Husky runs `lint-staged` on commit, which applies `prettier --write --ignore-unknown` to all staged files.

## Key Conventions

- Package manager is **pnpm** (not npm/yarn/bun). Always use `pnpm` to run scripts and install dependencies.
- TypeScript 6 is used.
- All packages use `"version": "0.0.0"` in source; real versions are set during CI publish.
