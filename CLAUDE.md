# CLAUDE.md

This file provides context for AI coding agents (Claude, Cursor, etc.) working on this plugin.

## Project Overview

This is an OpenACP plugin. OpenACP bridges AI coding agents to messaging platforms via the Agent Client Protocol (ACP). Plugins extend OpenACP with new adapters, services, commands, and middleware.

- **Package**: @openacp/cowork
- **SDK**: `@openacp/plugin-sdk` (types, base classes, testing utilities)
- **Entry point**: `src/index.ts` (default export of `OpenACPPlugin` object)
- **Purpose**: Multi-agent coordination — enables multiple AI agents to collaborate on the same codebase with status broadcasting and context injection

## Build & Run

```bash
npm install           # Install dependencies
npm run build         # Bundle with tsup (single-file output)
npm run dev           # Watch mode (tsup --watch)
npm run typecheck     # Type-check only (tsc --noEmit)
npm test              # Run tests (vitest)
```

### Development with hot-reload

```bash
openacp dev .         # Compiles, watches, and reloads plugin on changes
```

### Why tsup instead of tsc?

OpenACP's dev-loader copies a single `dist/index.js` to a temp path for ESM cache-busting. Multi-file tsc output breaks because relative imports don't resolve from temp. tsup bundles everything into one self-contained file.

- `tsconfig.json` has `noEmit: true` — tsc is for type-checking only
- `tsup.config.ts` bundles all source + deps (zod, nanoid) into `dist/index.js`
- Only `@openacp/cli` is external (peer dep, type-only at runtime)

## File Structure

```
src/
  index.ts              — Plugin entry point (exports OpenACPPlugin)
  cowork-orchestrator.ts — Group lifecycle management (create, end, restore)
  cowork-bridge.ts      — Per-group coordination (status broadcast, context injection, notifications)
  cowork-command.ts     — /cowork command handler (create, status, end subcommands)
  cowork-group.ts       — In-memory group model (members, status log)
  cowork-store.ts       — Persistent storage via PluginStorage
  cowork-prompt.ts      — System prompt builder for cowork agents
  types.ts              — Shared types (StatusEntry, CoworkMemberRecord, etc.)
  __tests__/
    plugin.test.ts              — Plugin metadata and lifecycle tests
    cowork-orchestrator.test.ts — Orchestrator unit tests
    cowork-bridge.test.ts       — Bridge status/context tests
    cowork-group.test.ts        — Group model tests
    cowork-store.test.ts        — Storage tests
    cowork-prompt.test.ts       — Prompt builder tests
dist/
  index.js              — Single bundled output (tsup)
  index.d.ts            — Type declarations
package.json
tsconfig.json           — noEmit: true (typecheck only)
tsup.config.ts          — Bundle config
CLAUDE.md               — This file
```

## How the Cowork Plugin Works

### Core Flow

```
User: /cowork "Team Alpha" claude:backend cursor:frontend
  ↓
CoworkCommand parses args, validates agents
  ↓
CoworkOrchestrator.createGroup()
  ├── Creates CoworkGroup (in-memory model)
  ├── Creates sessions for each agent via core.createSession()
  ├── Creates CoworkBridge (coordination engine)
  ├── Injects system prompts with cowork context
  └── Persists group via CoworkStore
  ↓
Middleware hooks (registered in setup):
  ├── agent:beforePrompt — injects context from other agents' recent status
  └── turn:end — broadcasts status after each agent turn
  ↓
Event listeners:
  ├── agent:event — tracks text/tool output per session
  └── session:created — restores bridge on daemon restart
```

### Key Components

**CoworkOrchestrator** — Manages group lifecycle. Creates groups with multiple agent sessions, tracks bridges, handles restore on daemon restart. Reads config from `ctx.pluginConfig`.

**CoworkBridge** — Per-group coordination engine. Buffers agent text/tool output, extracts explicit `[STATUS]` blocks or auto-generates status from output, broadcasts to group thread, injects context into agent prompts, notifies other agents, prevents notification loops.

**CoworkGroup** — In-memory model. Holds members (Map by sessionId), circular status log, workspace path. Serializable to/from JSON for persistence.

**CoworkStore** — Persistence layer using `ctx.storage` (PluginStorage). Debounced writes, load/save groups.

**CoworkCommand** — `/cowork` command with subcommands: create group, list status, end group.

### Settings (via settingsSchema)

```typescript
{
  maxAgentsPerGroup: number  // default 5, range 2-20
  statusLogSize: number      // default 50, range 10-500
  contextInjectionLimit: number // default 10, range 1-50
}
```

### Permissions Used

- `kernel:access` — access core.createSession, core.adapters, core.sessionManager
- `events:read` — listen to agent:event, session:created
- `events:emit` — emit cowork-specific events
- `middleware:register` — agent:beforePrompt, turn:end hooks
- `services:register` — register "cowork" service
- `services:use` — send messages to sessions
- `commands:register` — /cowork command
- `storage:read/write` — persist groups

## Architecture: How OpenACP Plugins Work

### Plugin Lifecycle

```
install ──> [reboot] ──> migrate? ──> setup ──> [running] ──> teardown ──> uninstall
```

| Hook | Trigger | Interactive? | Has Services? |
|------|---------|-------------|---------------|
| `install(ctx)` | `openacp plugin add <name>` | Yes | No |
| `migrate(ctx, oldSettings, oldVersion)` | Boot — stored version differs from plugin version | No | No |
| `configure(ctx)` | `openacp plugin configure <name>` | Yes | No |
| `setup(ctx)` | Every boot, after migrate | No | Yes |
| `teardown()` | Shutdown (10s timeout) | No | Yes |
| `uninstall(ctx, opts)` | `openacp plugin remove <name>` | Yes | No |

### OpenACPPlugin Interface

```typescript
interface OpenACPPlugin {
  name: string                    // unique identifier, e.g. '@myorg/my-plugin'
  version: string                 // semver
  description?: string
  permissions?: PluginPermission[]
  pluginDependencies?: Record<string, string>          // name -> semver range
  optionalPluginDependencies?: Record<string, string>  // used if available
  overrides?: string              // replace a built-in plugin entirely
  settingsSchema?: ZodSchema      // Zod validation for settings
  essential?: boolean             // true = needs setup before system can run

  setup(ctx: PluginContext): Promise<void>
  teardown?(): Promise<void>
  install?(ctx: InstallContext): Promise<void>
  configure?(ctx: InstallContext): Promise<void>
  migrate?(ctx: MigrateContext, oldSettings: unknown, oldVersion: string): Promise<unknown>
  uninstall?(ctx: InstallContext, opts: { purge: boolean }): Promise<void>
}
```

### PluginContext API (available in setup)

```typescript
interface PluginContext {
  pluginName: string
  pluginConfig: Record<string, unknown>   // from settings.json

  // Events (requires 'events:read' / 'events:emit')
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
  emit(event: string, payload: unknown): void

  // Services (requires 'services:register' / 'services:use')
  registerService<T>(name: string, implementation: T): void
  getService<T>(name: string): T | undefined

  // Middleware (requires 'middleware:register')
  registerMiddleware<H extends MiddlewareHook>(hook: H, opts: MiddlewareOptions<MiddlewarePayloadMap[H]>): void

  // Commands (requires 'commands:register')
  registerCommand(def: CommandDef): void

  // Storage (requires 'storage:read' / 'storage:write')
  storage: PluginStorage  // get, set, delete, list, getDataDir

  // Messaging (requires 'services:use')
  sendMessage(sessionId: string, content: OutgoingMessage): Promise<void>

  // Kernel access (requires 'kernel:access')
  sessions: SessionManager
  config: ConfigManager
  eventBus: EventBus

  // Always available
  log: Logger  // trace, debug, info, warn, error, fatal, child
}
```

### Middleware Hooks (18 total)

Register with `ctx.registerMiddleware(hook, { priority?, handler })`. Return `null` to block the flow, call `next()` to continue.

**This plugin uses:**
- `agent:beforePrompt` — injects cowork context from other agents' recent status
- `turn:end` — triggers status broadcast after each agent turn

**All available hooks:**
message:incoming, message:outgoing, agent:beforePrompt, agent:beforeEvent, agent:afterEvent, turn:start, turn:end, fs:beforeRead, fs:beforeWrite, terminal:beforeCreate, terminal:afterExit, permission:beforeRequest, permission:afterResolve, session:beforeCreate, session:afterDestroy, mode:beforeChange, config:beforeChange, model:beforeChange, agent:beforeCancel

### Plugin Events (subscribe with ctx.on)

**This plugin listens to:**
- `agent:event` — tracks agent text/tool output for status extraction
- `session:created` — restores bridge coordination on daemon restart

## Testing

Tests use Vitest with manual mocks (not `@openacp/plugin-sdk/testing` since SDK is not published yet).

```bash
npm test              # run all tests
npm run test:watch    # watch mode
```

## Conventions

- **ESM-only**: `"type": "module"` in package.json
- **Import extensions**: All imports use `.js` extension (e.g., `import x from './util.js'`)
- **TypeScript strict mode**: `strict: true` in tsconfig.json
- **Target**: ES2022, module NodeNext
- **Logger type**: Use `PluginContext["log"]` instead of importing `Logger` directly (avoids ambiguous re-export conflict between plugin types and pino)
- **Bundle output**: Single file via tsup — never commit multi-file tsc output to dist/
