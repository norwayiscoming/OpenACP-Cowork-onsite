# Plugin Developer Guide

## Overview

**@openacp/cowork** is an OpenACP plugin that enables multi-agent coordination. It lets multiple AI coding agents (Claude, Cursor, Gemini, etc.) collaborate on the same codebase with automatic status broadcasting and context injection.

### What it does

- Creates **cowork groups** with multiple agents, each with a defined role
- **Broadcasts status** — when one agent finishes a task, others get notified
- **Injects context** — before each prompt, agents see what their peers have done
- **Prevents loops** — suppression tracking stops infinite notification ping-pong
- **Persists state** — groups survive daemon restarts

## Project Structure

```
src/
  index.ts              — Plugin entry point (exports OpenACPPlugin object)
  cowork-orchestrator.ts — Group lifecycle (create, end, restore)
  cowork-bridge.ts      — Per-group coordination engine
  cowork-command.ts     — /cowork command handler
  cowork-group.ts       — In-memory group model
  cowork-store.ts       — Persistent storage
  cowork-prompt.ts      — System prompt builder
  types.ts              — Shared types
  __tests__/            — Tests using Vitest
dist/
  index.js              — Single bundled output (tsup)
tsup.config.ts          — Bundle config
tsconfig.json           — TypeScript config (noEmit, typecheck only)
CLAUDE.md               — Full technical reference for AI agents
PLUGIN_GUIDE.md         — This file
```

## Development Workflow

1. **Edit** source files in `src/`
2. **Dev mode**: `openacp dev .` — compiles, watches, and hot-reloads the plugin
3. **Test**: `npm test` — runs all tests with Vitest
4. **Build**: `npm run build` — bundles with tsup into `dist/index.js`
5. **Typecheck**: `npm run typecheck` — runs `tsc --noEmit`

```bash
npm install
openacp dev .     # start developing with hot-reload
npm test          # run tests
npm run build     # bundle for publishing
```

### Why tsup?

OpenACP's dev-loader copies `dist/index.js` to a temp file for hot-reload. It expects a single self-contained file. tsup bundles all source code and dependencies into one file.

## Usage

### Create a cowork group

```
/cowork "Team Alpha" claude:backend cursor:frontend
```

Creates a group with two agents — Claude handling backend, Cursor handling frontend.

### Check status

```
/cowork status
```

Lists all active cowork groups with members.

### End a group

```
/cowork end
/cowork end <group-id>
```

## Settings

Configurable via `openacp plugin configure @openacp/cowork`:

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `maxAgentsPerGroup` | 5 | 2–20 | Maximum agents per group |
| `statusLogSize` | 50 | 10–500 | Status entries kept in memory |
| `contextInjectionLimit` | 10 | 1–50 | Recent statuses injected per prompt |

## Testing

```bash
npm test              # run all 35 tests
npm run test:watch    # watch mode
```

Tests use manual mocks for PluginContext and services.

## Publishing

1. Update `version` in both `package.json` and `src/index.ts`
2. Build and test:
   ```bash
   npm run build
   npm test
   ```
3. Publish:
   ```bash
   npm publish --access public
   ```
4. Users install with:
   ```bash
   openacp plugin install @openacp/cowork
   ```
5. Submit to the [OpenACP Plugin Registry](https://github.com/Open-ACP/plugin-registry) for discoverability.
