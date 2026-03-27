# Cowork Plugin Microkernel Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the cowork plugin with the OpenACP microkernel plugin architecture.

**Architecture:** Minimal migration — fix imports, package.json, delete old files, add lifecycle hooks and settings schema. All business logic preserved as-is.

**Tech Stack:** TypeScript, Zod, Vitest, @openacp/plugin-sdk

---

### Task 1: Delete obsolete files

**Files:**
- Delete: `src/plugin.ts`
- Delete: `src/commands/telegram-cowork.ts`
- Delete: `src/__tests__/integration.test.ts` (tests for old CorePlugin interface)

- [ ] **Step 1: Delete the three obsolete files**

```bash
git rm src/plugin.ts src/commands/telegram-cowork.ts src/__tests__/integration.test.ts
```

- [ ] **Step 2: Verify no other files import from deleted files**

```bash
grep -r "plugin\.js\|telegram-cowork\|from.*\.\/plugin" src/ --include="*.ts"
```

Expected: No matches (only `index.ts` imports from local modules, not `plugin.ts`).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: delete obsolete CorePlugin files (plugin.ts, telegram-cowork.ts, integration.test.ts)"
```

---

### Task 2: Fix package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json**

Replace the entire `package.json` with:

```json
{
  "name": "@openacp/cowork",
  "version": "1.0.0",
  "description": "Multi-agent coordination layer built on top of OpenACP",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["openacp", "openacp-plugin", "cowork", "multi-agent"],
  "repository": {
    "type": "git",
    "url": "https://github.com/Open-ACP/OpenACP-Cowork"
  },
  "engines": {
    "node": ">=20",
    "openacp": ">=2026.0326.0"
  },
  "peerDependencies": {
    "@openacp/cli": ">=2026.0326.0"
  },
  "dependencies": {
    "nanoid": "^5.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@openacp/plugin-sdk": "^1.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

Key changes:
- Removed `"plugin": "dist/plugin.js"` field
- Removed `"require"` from exports (ESM only)
- Removed `dependencies.openacp: "file:../OpenACP"`
- Added `peerDependencies["@openacp/cli"]`
- Added `devDependencies["@openacp/plugin-sdk"]`
- Added `dependencies.zod` (for settingsSchema)
- Added `engines.openacp`
- Added `keywords`
- Bumped version to `1.0.0` to match `src/index.ts`

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: align package.json with microkernel plugin structure"
```

---

### Task 3: Fix imports across source files

**Files:**
- Modify: `src/index.ts` (line 1)
- Modify: `src/cowork-orchestrator.ts` (line 6)
- Modify: `src/cowork-command.ts` (line 3)
- Modify: `src/cowork-store.ts` (line 3)
- Modify: `src/cowork-bridge.ts` (line 5)
- Modify: `src/__tests__/plugin.test.ts` (line 3)

- [ ] **Step 1: Fix import in `src/index.ts`**

Change line 1 from:
```typescript
import type { OpenACPPlugin, PluginContext } from "openacp/dist/index.js";
```
to:
```typescript
import type { OpenACPPlugin, PluginContext, InstallContext, MigrateContext } from "@openacp/plugin-sdk";
```

- [ ] **Step 2: Fix import in `src/cowork-orchestrator.ts`**

Change line 6 from:
```typescript
import type { PluginContext, Logger } from "openacp/dist/index.js";
```
to:
```typescript
import type { PluginContext, Logger } from "@openacp/plugin-sdk";
```

- [ ] **Step 3: Fix import in `src/cowork-command.ts`**

Change line 3 from:
```typescript
import type { CommandDef, CommandArgs, Logger } from "openacp/dist/index.js";
```
to:
```typescript
import type { CommandDef, CommandArgs, CommandResponse, Logger } from "@openacp/plugin-sdk";
```

- [ ] **Step 4: Fix import in `src/cowork-store.ts`**

Change line 3 from:
```typescript
import type { PluginStorage, Logger } from "openacp/dist/index.js";
```
to:
```typescript
import type { PluginStorage, Logger } from "@openacp/plugin-sdk";
```

- [ ] **Step 5: Fix import in `src/cowork-bridge.ts`**

Change line 5 from:
```typescript
import type { Logger, AgentEvent } from "openacp/dist/index.js";
```
to:
```typescript
import type { Logger, AgentEvent } from "@openacp/plugin-sdk";
```

- [ ] **Step 6: Fix import in `src/__tests__/plugin.test.ts`**

Change line 3 from:
```typescript
import { LifecycleManager, ServiceRegistry, MiddlewareChain, ErrorTracker } from "openacp/dist/index.js";
```
to:
```typescript
import { LifecycleManager, ServiceRegistry, MiddlewareChain, ErrorTracker } from "@openacp/cli";
```

Note: test infrastructure classes come from `@openacp/cli` (the runtime), not `@openacp/plugin-sdk` (the types package).

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "refactor: update imports from openacp/dist to @openacp/plugin-sdk"
```

---

### Task 4: Add `category: 'plugin'` to CommandDef

**Files:**
- Modify: `src/cowork-command.ts`

- [ ] **Step 1: Add category field to the CommandDef return**

In `src/cowork-command.ts`, in the `createCoworkCommand` function, add `category: "plugin"` to the returned object. The return should become:

```typescript
  return {
    name: "cowork",
    description: "Manage multi-agent collaboration groups",
    usage: '"Group Name" agent1:role1 agent2:role2 | status | end [groupId]',
    category: "plugin",

    async handler(args: CommandArgs): Promise<CommandResponse | void> {
```

Note: also update the handler return type from `Promise<void>` to `Promise<CommandResponse | void>` to match the `CommandDef` interface.

- [ ] **Step 2: Commit**

```bash
git add src/cowork-command.ts
git commit -m "fix: add category 'plugin' to cowork CommandDef"
```

---

### Task 5: Add settings schema and lifecycle hooks

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add Zod settings schema and lifecycle hooks to `src/index.ts`**

Replace the entire `src/index.ts` with:

```typescript
import { z } from "zod";
import type { OpenACPPlugin, PluginContext, InstallContext, MigrateContext } from "@openacp/plugin-sdk";
import { CoworkOrchestrator, type CoworkCoreAccess } from "./cowork-orchestrator.js";
import { createCoworkCommand } from "./cowork-command.js";

let orchestrator: CoworkOrchestrator | null = null;

export function getOrchestrator(): CoworkOrchestrator {
  if (!orchestrator) throw new Error("Cowork plugin not initialized");
  return orchestrator;
}

const settingsSchema = z.object({
  maxAgentsPerGroup: z.number().int().min(2).max(20).default(5),
  statusLogSize: z.number().int().min(10).max(500).default(50),
  contextInjectionLimit: z.number().int().min(1).max(50).default(10),
});

function createCoworkPlugin(): OpenACPPlugin {
  return {
    name: "@openacp/cowork",
    version: "1.0.0",
    description: "Multi-agent collaboration groups with status broadcasting and context injection",
    pluginDependencies: {
      "@openacp/security": "^1.0.0",
    },
    optionalPluginDependencies: {
      "@openacp/notifications": "^1.0.0",
    },
    permissions: [
      "kernel:access",
      "events:read",
      "events:emit",
      "middleware:register",
      "services:register",
      "services:use",
      "commands:register",
      "storage:read",
      "storage:write",
    ],
    settingsSchema,

    async install(ctx: InstallContext) {
      const maxAgents = await ctx.terminal.select({
        message: "Max agents per cowork group:",
        options: [
          { value: 3, label: "3 (small team)" },
          { value: 5, label: "5 (default)" },
          { value: 10, label: "10 (large team)" },
        ],
      });

      await ctx.settings.setAll({
        maxAgentsPerGroup: maxAgents,
        statusLogSize: 50,
        contextInjectionLimit: 10,
      });

      ctx.terminal.log.success("Cowork plugin configured!");
    },

    async configure(ctx: InstallContext) {
      const current = await ctx.settings.getAll();

      const maxAgents = await ctx.terminal.select({
        message: `Max agents per group (current: ${current.maxAgentsPerGroup ?? 5}):`,
        options: [
          { value: 3, label: "3 (small team)" },
          { value: 5, label: "5 (default)" },
          { value: 10, label: "10 (large team)" },
        ],
      });

      const statusLogSize = await ctx.terminal.select({
        message: `Status log size (current: ${current.statusLogSize ?? 50}):`,
        options: [
          { value: 25, label: "25 (compact)" },
          { value: 50, label: "50 (default)" },
          { value: 100, label: "100 (verbose)" },
        ],
      });

      const contextLimit = await ctx.terminal.select({
        message: `Context injection limit (current: ${current.contextInjectionLimit ?? 10}):`,
        options: [
          { value: 5, label: "5 (minimal)" },
          { value: 10, label: "10 (default)" },
          { value: 20, label: "20 (detailed)" },
        ],
      });

      await ctx.settings.setAll({
        maxAgentsPerGroup: maxAgents,
        statusLogSize,
        contextInjectionLimit: contextLimit,
      });

      ctx.terminal.log.success("Cowork settings updated!");
    },

    async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
      if (opts.purge) {
        await ctx.settings.clear();
        ctx.terminal.log.success("Cowork settings and data cleared.");
      }
    },

    async migrate(_ctx: MigrateContext, oldSettings: unknown, _oldVersion: string) {
      return oldSettings;
    },

    async setup(ctx: PluginContext) {
      const core = ctx.core as CoworkCoreAccess;

      orchestrator = new CoworkOrchestrator(ctx);
      await orchestrator.init();

      ctx.registerService("cowork", orchestrator);

      ctx.registerCommand(createCoworkCommand(orchestrator, core, ctx.log));

      ctx.on("agent:event", (...args: unknown[]) => {
        const payload = args[0] as { sessionId: string; event: { type: string; content?: string; name?: string; status?: string } };
        if (!payload?.sessionId || !payload?.event) return;
        const bridge = orchestrator?.getBridgeForSession(payload.sessionId);
        if (bridge) {
          bridge.handleAgentEvent(payload.sessionId, payload.event as any);
        }
      });

      ctx.registerMiddleware("agent:beforePrompt", {
        priority: 50,
        handler: async (payload, next) => {
          const bridge = orchestrator?.getBridgeForSession(payload.sessionId);
          if (bridge) {
            const context = bridge.buildCoworkContext(payload.sessionId);
            if (context) {
              payload.text = `${context}\n\n---\n\n${payload.text}`;
            }
          }
          return next();
        },
      });

      ctx.registerMiddleware("turn:end", {
        handler: async (payload, next) => {
          const bridge = orchestrator?.getBridgeForSession(payload.sessionId);
          if (bridge) {
            bridge.handleTurnEnd(payload.sessionId);
          }
          return next();
        },
      });

      ctx.on("session:created", (...args: unknown[]) => {
        const payload = args[0] as { sessionId: string } | undefined;
        if (!payload?.sessionId) return;
        const group = orchestrator?.getGroupForSession(payload.sessionId);
        if (group) {
          orchestrator?.restoreBridge(group.id, payload.sessionId);
        }
      });

      ctx.log.info("Cowork plugin ready");
    },

    async teardown() {
      orchestrator?.destroy();
      orchestrator = null;
    },
  };
}

export default createCoworkPlugin();
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add settingsSchema, install, configure, uninstall, migrate lifecycle hooks"
```

---

### Task 6: Update CoworkOrchestrator to read from pluginConfig

**Files:**
- Modify: `src/cowork-orchestrator.ts`

- [ ] **Step 1: Update constructor and getConfig to use pluginConfig**

In `src/cowork-orchestrator.ts`, change the constructor to also capture `pluginConfig`, and update `getConfig()` to read from it instead of `core.configManager.get().cowork`:

Replace the class fields and constructor:

```typescript
export class CoworkOrchestrator {
  private store: CoworkStore;
  private bridges: Map<string, CoworkBridge> = new Map();
  private core: CoworkCoreAccess;
  private log: Logger;
  private pluginConfig: Record<string, unknown>;

  constructor(ctx: PluginContext) {
    this.core = ctx.core as CoworkCoreAccess;
    this.log = ctx.log;
    this.pluginConfig = ctx.pluginConfig;
    this.store = new CoworkStore(ctx.storage, ctx.log);
  }
```

Replace the `getConfig()` method:

```typescript
  private getConfig(): CoworkConfig {
    return {
      maxAgentsPerGroup: (this.pluginConfig.maxAgentsPerGroup as number) ?? 5,
      statusLogSize: (this.pluginConfig.statusLogSize as number) ?? 50,
      contextInjectionLimit: (this.pluginConfig.contextInjectionLimit as number) ?? 10,
    };
  }
```

- [ ] **Step 2: Remove the `cowork` config type from `CoworkCoreAccess`**

In `CoworkCoreAccess` interface, simplify `configManager` — remove the `cowork` property since settings now come from `pluginConfig`:

```typescript
export interface CoworkCoreAccess {
  configManager: {
    get(): Record<string, unknown>;
    resolveWorkspace?(): string;
  };
  adapters: Map<string, { sendMessage(threadId: string, msg: { type: string; text: string }): Promise<void> }>;
  sessionManager: {
    getSession(sessionId: string): { id: string; status: string; enqueuePrompt(text: string): Promise<void> } | undefined;
    patchRecord(sessionId: string, patch: Record<string, unknown>): void;
  };
  createSession(params: {
    channelId: string;
    agentName: string;
    workingDirectory: string;
    createThread?: boolean;
    initialName?: string;
  }): Promise<{ id: string; status: string; enqueuePrompt(text: string): Promise<void> }>;
  agentCatalog?: {
    resolve(name: string): unknown;
  };
}
```

- [ ] **Step 3: Update orchestrator test mock**

In `src/__tests__/cowork-orchestrator.test.ts`, if the `makeOrchestrator()` helper creates a mock PluginContext, ensure it includes `pluginConfig`:

```typescript
pluginConfig: { maxAgentsPerGroup: 5, statusLogSize: 50, contextInjectionLimit: 10 },
```

- [ ] **Step 4: Commit**

```bash
git add src/cowork-orchestrator.ts src/__tests__/cowork-orchestrator.test.ts
git commit -m "refactor: read cowork config from pluginConfig instead of core.configManager"
```

---

### Task 7: Update plugin.test.ts for new structure

**Files:**
- Modify: `src/__tests__/plugin.test.ts`

- [ ] **Step 1: Update the test to work with new imports and structure**

Replace `src/__tests__/plugin.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LifecycleManager, ServiceRegistry, MiddlewareChain, ErrorTracker } from "@openacp/cli";
import coworkPlugin from "../index.js";

function mockEventBus() {
  const listeners = new Map<string, Set<Function>>();
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      for (const h of listeners.get(event) ?? []) h(...args);
    }),
  };
}

function mockCore() {
  return {
    configManager: {
      get: () => ({}),
      resolveWorkspace: () => "/tmp/test-workspace",
    },
    sessionManager: {
      getSession: vi.fn(),
      patchRecord: vi.fn(),
    },
    adapters: new Map(),
    createSession: vi.fn(),
    agentCatalog: { resolve: vi.fn().mockReturnValue({}) },
  };
}

describe("Cowork Plugin Integration", () => {
  let serviceRegistry: ServiceRegistry;
  let middlewareChain: MiddlewareChain;
  let eventBus: ReturnType<typeof mockEventBus>;
  let core: ReturnType<typeof mockCore>;

  beforeEach(() => {
    serviceRegistry = new ServiceRegistry();
    middlewareChain = new MiddlewareChain();
    eventBus = mockEventBus();
    core = mockCore();
  });

  it("has correct plugin metadata", () => {
    expect(coworkPlugin.name).toBe("@openacp/cowork");
    expect(coworkPlugin.version).toBe("1.0.0");
    expect(coworkPlugin.permissions).toContain("kernel:access");
    expect(coworkPlugin.permissions).toContain("commands:register");
    expect(coworkPlugin.settingsSchema).toBeDefined();
  });

  it("has all lifecycle hooks", () => {
    expect(typeof coworkPlugin.setup).toBe("function");
    expect(typeof coworkPlugin.teardown).toBe("function");
    expect(typeof coworkPlugin.install).toBe("function");
    expect(typeof coworkPlugin.configure).toBe("function");
    expect(typeof coworkPlugin.uninstall).toBe("function");
    expect(typeof coworkPlugin.migrate).toBe("function");
  });

  it("boots and registers service and command", async () => {
    const lm = new LifecycleManager({
      serviceRegistry,
      middlewareChain,
      errorTracker: new ErrorTracker(),
      eventBus: eventBus as any,
      storagePath: "/tmp/openacp-test-plugins",
      sessions: core.sessionManager,
      config: core.configManager,
      core,
    });

    const testPlugin = { ...coworkPlugin, pluginDependencies: undefined };
    await lm.boot([testPlugin]);

    expect(lm.loadedPlugins).toContain("@openacp/cowork");
    expect(serviceRegistry.has("cowork")).toBe(true);

    expect(eventBus.on).toHaveBeenCalledWith("agent:event", expect.any(Function));
    expect(eventBus.on).toHaveBeenCalledWith("session:created", expect.any(Function));

    await lm.shutdown();
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/__tests__/plugin.test.ts
git commit -m "test: update plugin test for microkernel structure"
```

---

### Task 8: Install dependencies and verify build + tests

**Files:**
- Modify: `package-lock.json` (auto-generated)

- [ ] **Step 1: Install dependencies**

```bash
npm install
```

- [ ] **Step 2: Verify TypeScript build**

```bash
npm run build
```

Expected: No errors. `dist/` contains compiled JS files.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: All tests pass. The `plugin.test.ts` test may fail if `@openacp/cli` LifecycleManager isn't available in the test environment — in that case, adjust the test to use `createTestContext` from `@openacp/plugin-sdk/testing` instead:

```typescript
import { createTestContext } from "@openacp/plugin-sdk/testing";
import coworkPlugin from "../index.js";

describe("Cowork Plugin Integration", () => {
  it("registers service and command on setup", async () => {
    const ctx = createTestContext({
      pluginName: "@openacp/cowork",
      pluginConfig: { maxAgentsPerGroup: 5, statusLogSize: 50, contextInjectionLimit: 10 },
    });

    await coworkPlugin.setup(ctx);

    expect(ctx.registeredServices.has("cowork")).toBe(true);
    expect(ctx.registeredCommands.has("cowork")).toBe(true);
    expect(ctx.registeredMiddleware.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 4: Commit lock file if changed**

```bash
git add package-lock.json
git commit -m "chore: update package-lock.json after dependency changes"
```
