# Cowork Plugin — Microkernel Migration Design

**Date:** 2026-03-27
**Branch:** `feat/cowork`
**Approach:** Minimal fix — align existing code with microkernel plugin structure, preserve all business logic.

## Context

The OpenACP main repo has a `redesign/microkernel-plugin-architecture` branch that defines a new plugin system. The cowork plugin on `feat/cowork` was written mid-transition and mixes old (`CorePlugin`/`PluginAPI`) and new (`OpenACPPlugin`/`PluginContext`) patterns. This migration aligns it fully with the microkernel architecture.

## Changes

### 1. Fix imports across all source files

**Current:** `from "openacp/dist/index.js"`
**Target:** `from "@openacp/plugin-sdk"`

Affected files: `src/index.ts`, `src/cowork-orchestrator.ts`, `src/cowork-command.ts`, and any test files importing from the old path.

### 2. Fix `package.json`

| Field | Current | Target |
|-------|---------|--------|
| `"plugin"` | `"dist/plugin.js"` | Remove entirely |
| `dependencies.openacp` | `"file:../OpenACP"` | Remove |
| `peerDependencies` | absent | `{ "@openacp/cli": ">=2026.0326.0" }` |
| `devDependencies` | missing SDK | Add `"@openacp/plugin-sdk": "^1.0.0"` |
| `engines` | only node | Add `"openacp": ">=2026.0326.0"` |
| `keywords` | absent | `["openacp", "openacp-plugin", "cowork", "multi-agent"]` |

### 3. Delete obsolete files

- `src/plugin.ts` — old `CorePlugin` interface, fully superseded by `src/index.ts`
- `src/commands/telegram-cowork.ts` — adapter-specific handler, replaced by generic `registerCommand()`
- `src/__tests__/plugin.test.ts` — tests for the deleted `plugin.ts`

### 4. Add `category: 'plugin'` to CommandDef

The microkernel `CommandDef` type requires `category: 'system' | 'plugin'`. Add `category: 'plugin'` in:
- `src/index.ts` (where `createCoworkCommand` is called — already delegated to `cowork-command.ts`)
- `src/cowork-command.ts` (the actual CommandDef return)

### 5. Add lifecycle hooks to `src/index.ts`

Add minimal implementations:

- **`install(ctx: InstallContext)`** — log success, save default settings
- **`configure(ctx: InstallContext)`** — allow reconfiguring maxAgentsPerGroup, statusLogSize, contextInjectionLimit
- **`uninstall(ctx: InstallContext, opts)`** — clear storage on purge
- **`migrate(ctx: MigrateContext, oldSettings, oldVersion)`** — passthrough for now (return oldSettings)
- **`settingsSchema`** — Zod schema validating `maxAgentsPerGroup`, `statusLogSize`, `contextInjectionLimit`

### 6. Update `CoworkOrchestrator` to read config from `ctx.pluginConfig`

Currently reads from `core.configManager.get().cowork`. After migration, settings come from `ctx.pluginConfig` (populated from the plugin's `settingsSchema`). Update `getConfig()` accordingly.

### 7. Update tests

- Remove `src/__tests__/plugin.test.ts`
- Update imports in remaining test files from `"openacp/dist/index.js"` to `"@openacp/plugin-sdk"`
- Ensure `src/__tests__/integration.test.ts` still passes with updated structure

## Out of Scope

- No changes to business logic in `cowork-bridge.ts`, `cowork-group.ts`, `cowork-store.ts`, `cowork-prompt.ts`, `types.ts`
- No new features
- No adapter-specific code (microkernel handles adapter routing)

## Verification

- `npm run build` passes with no type errors
- `npm test` passes all remaining tests
- Plugin default export matches `OpenACPPlugin` interface
