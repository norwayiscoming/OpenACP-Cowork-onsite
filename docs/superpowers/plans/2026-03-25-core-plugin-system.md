# Core Plugin System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable OpenACP to load core plugins (not just adapter plugins), and restructure @openacp/cowork as the first core plugin — installable via `openacp install @openacp/cowork`.

**Architecture:** OpenACP's plugin-manager gains a `CorePlugin` interface alongside the existing `AdapterFactory`. On startup (`main.ts`), core plugins are loaded and `register(core)` is called. Plugins can register abstract commands (platform-agnostic) and optional adapter-specific command overrides. @openacp/cowork exports a `CorePlugin` that wires CoworkBridge, CoworkStore, CoworkGroup, and the /cowork command into OpenACPCore — without duplicating any OpenACP logic.

**Tech Stack:** TypeScript (ESM), OpenACP core APIs, grammY (for Telegram-specific handler)

---

## File Structure

### OpenACP changes (repo: `/Users/lab3/Desktop/agi/OpenACP`)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/core/plugin-manager.ts` | Modify | Add `CorePlugin` interface, `loadCorePlugin()` |
| `src/core/core.ts` | Modify | Add `plugins` map, `loadPlugin()`, `getPlugin()`, plugin command registry |
| `src/core/types.ts` | Modify | Add `PluginCommand` type |
| `src/core/index.ts` | Modify | Export new types |
| `src/main.ts` | Modify | Load core plugins at startup |
| `src/adapters/telegram/commands/index.ts` | Modify | Register plugin commands dynamically |
| `src/core/__tests__/core-plugin.test.ts` | Create | Tests for plugin loading |

### @openacp/cowork changes (repo: `/Users/lab3/Desktop/agi/openacp-cowork`)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/plugin.ts` | Create | CorePlugin export — the main entry point |
| `src/cowork-orchestrator.ts` | Create | Group lifecycle (create, end, list, restore) — extracted from OpenACPCore |
| `src/commands/cowork-command.ts` | Create | Platform-agnostic /cowork command handler |
| `src/commands/telegram-cowork.ts` | Create | Telegram-specific /cowork handler (forum topics, HTML formatting) |
| `src/index.ts` | Modify | Export plugin + orchestrator |
| `package.json` | Modify | Add `plugin` field pointing to entry |
| `src/__tests__/plugin.test.ts` | Create | Plugin registration tests |
| `src/__tests__/cowork-orchestrator.test.ts` | Create | Orchestrator tests |

---

### Task 1: Add CorePlugin interface to OpenACP

**Files:**
- Modify: `src/core/plugin-manager.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/index.ts`
- Test: `src/core/__tests__/core-plugin.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/__tests__/core-plugin.test.ts
import { describe, it, expect, vi } from "vitest";
import type { CorePlugin, PluginCommand } from "../types.js";

describe("CorePlugin interface", () => {
  it("accepts a minimal plugin with name and register", () => {
    const plugin: CorePlugin = {
      name: "test-plugin",
      version: "1.0.0",
      register: vi.fn(),
    };
    expect(plugin.name).toBe("test-plugin");
    expect(typeof plugin.register).toBe("function");
  });

  it("accepts a plugin with commands", () => {
    const cmd: PluginCommand = {
      name: "test",
      description: "A test command",
      usage: "/test [args]",
    };
    const plugin: CorePlugin = {
      name: "test-plugin",
      version: "1.0.0",
      register: vi.fn(),
      commands: [cmd],
    };
    expect(plugin.commands).toHaveLength(1);
    expect(plugin.commands![0].name).toBe("test");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lab3/Desktop/agi/OpenACP && pnpm test -- src/core/__tests__/core-plugin.test.ts`
Expected: FAIL — `CorePlugin` and `PluginCommand` types don't exist

- [ ] **Step 3: Add types to types.ts**

In `src/core/types.ts`, append:

```typescript
// --- Core Plugin System ---

export interface PluginCommand {
  name: string;
  description: string;
  usage?: string;
}

export interface CorePlugin {
  name: string;
  version: string;
  register(core: any): void | Promise<void>;
  unregister?(): void | Promise<void>;
  commands?: PluginCommand[];
  /** Adapter-specific command handlers keyed by adapter name (e.g. "telegram") */
  adapterCommands?: Record<string, Array<{
    command: string;
    handler: (ctx: any, core: any, ...args: any[]) => Promise<void>;
  }>>;
}
```

- [ ] **Step 4: Export from index.ts**

In `src/core/index.ts`, add:

```typescript
export type { CorePlugin, PluginCommand } from './types.js'
```

- [ ] **Step 5: Add loadCorePlugin to plugin-manager.ts**

In `src/core/plugin-manager.ts`, add after `loadAdapterFactory`:

```typescript
export async function loadCorePlugin(packageName: string): Promise<CorePlugin | null> {
  try {
    const require = createRequire(path.join(PLUGINS_DIR, 'package.json'))
    const resolved = require.resolve(packageName)
    const mod = await import(resolved)

    const plugin: CorePlugin | undefined = mod.corePlugin || mod.plugin || mod.default
    if (!plugin || typeof plugin.register !== 'function' || !plugin.name) {
      log.error({ packageName }, 'Plugin does not export a valid CorePlugin (needs .name and .register())')
      return null
    }
    return plugin
  } catch (err) {
    log.error({ packageName, err }, 'Failed to load core plugin')
    return null
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/lab3/Desktop/agi/OpenACP && pnpm test -- src/core/__tests__/core-plugin.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/lab3/Desktop/agi/OpenACP
git add src/core/types.ts src/core/index.ts src/core/plugin-manager.ts src/core/__tests__/core-plugin.test.ts
git commit -m "feat: add CorePlugin interface and loadCorePlugin to plugin system"
```

---

### Task 2: Add plugin loading to OpenACPCore

**Files:**
- Modify: `src/core/core.ts`
- Modify: `src/core/config.ts` (add `plugins` config field)
- Test: extend `src/core/__tests__/core-plugin.test.ts`

- [ ] **Step 1: Write the failing test**

Extend `core-plugin.test.ts`:

```typescript
describe("OpenACPCore plugin loading", () => {
  it("loadPlugin registers plugin and stores it", async () => {
    // This test will need a mock ConfigManager — minimal setup
    const { OpenACPCore } = await import("../core.js");
    const { ConfigManager } = await import("../config.js");

    const configManager = new ConfigManager();
    // Use a temp config for test
    const core = new OpenACPCore(configManager);

    const plugin: CorePlugin = {
      name: "test-plugin",
      version: "1.0.0",
      register: vi.fn(),
      commands: [{ name: "test", description: "Test cmd" }],
    };

    await core.loadPlugin(plugin);
    expect(plugin.register).toHaveBeenCalledWith(core);
    expect(core.getPlugin("test-plugin")).toBe(plugin);
    expect(core.getPluginCommands()).toContainEqual(
      expect.objectContaining({ name: "test" })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lab3/Desktop/agi/OpenACP && pnpm test -- src/core/__tests__/core-plugin.test.ts`
Expected: FAIL — `loadPlugin`, `getPlugin`, `getPluginCommands` don't exist

- [ ] **Step 3: Add plugin methods to OpenACPCore**

In `src/core/core.ts`, add to class fields:

```typescript
private plugins: Map<string, CorePlugin> = new Map();
private pluginCommands: PluginCommand[] = [];
```

Add methods:

```typescript
async loadPlugin(plugin: CorePlugin): Promise<void> {
  if (this.plugins.has(plugin.name)) {
    log.warn({ plugin: plugin.name }, "Plugin already loaded, skipping");
    return;
  }
  await plugin.register(this);
  this.plugins.set(plugin.name, plugin);
  if (plugin.commands) {
    this.pluginCommands.push(...plugin.commands);
  }
  log.info({ plugin: plugin.name, version: plugin.version }, "Core plugin loaded");
}

getPlugin(name: string): CorePlugin | undefined {
  return this.plugins.get(name);
}

getPluginCommands(): PluginCommand[] {
  return this.pluginCommands;
}

getPluginAdapterCommands(adapterName: string): Array<{ command: string; handler: Function }> {
  const commands: Array<{ command: string; handler: Function }> = [];
  for (const plugin of this.plugins.values()) {
    const adapterCmds = plugin.adapterCommands?.[adapterName];
    if (adapterCmds) commands.push(...adapterCmds);
  }
  return commands;
}
```

Add import at top:

```typescript
import type { CorePlugin, PluginCommand } from "./types.js";
```

- [ ] **Step 4: Add `plugins` field to config schema**

In `src/core/config.ts`, add to the Zod schema under the root:

```typescript
plugins: z.array(z.string()).default([]).describe("Core plugins to load at startup"),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/lab3/Desktop/agi/OpenACP && pnpm test -- src/core/__tests__/core-plugin.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/lab3/Desktop/agi/OpenACP
git add src/core/core.ts src/core/config.ts src/core/__tests__/core-plugin.test.ts
git commit -m "feat: add plugin loading to OpenACPCore with config support"
```

---

### Task 3: Load core plugins at startup in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add plugin loading after adapter registration**

In `src/main.ts`, after the adapter registration loop (line ~94) and before `core.start()`:

```typescript
// 4.5 Load core plugins from config
import { loadCorePlugin } from './core/plugin-manager.js'

if (config.plugins && config.plugins.length > 0) {
  for (const pluginName of config.plugins) {
    const plugin = await loadCorePlugin(pluginName)
    if (plugin) {
      await core.loadPlugin(plugin)
    } else {
      log.error({ plugin: pluginName }, 'Failed to load core plugin')
    }
  }
}
```

- [ ] **Step 2: Build and verify no type errors**

Run: `cd /Users/lab3/Desktop/agi/OpenACP && pnpm build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
cd /Users/lab3/Desktop/agi/OpenACP
git add src/main.ts
git commit -m "feat: load core plugins at startup from config"
```

---

### Task 4: Register plugin commands in Telegram adapter

**Files:**
- Modify: `src/adapters/telegram/commands/index.ts`
- Modify: `src/adapters/telegram/adapter.ts`

- [ ] **Step 1: Add dynamic plugin command registration**

In `src/adapters/telegram/commands/index.ts`, after existing command registrations, add:

```typescript
// Register plugin commands (adapter-specific overrides)
const pluginCommands = core.getPluginAdapterCommands("telegram");
for (const { command, handler } of pluginCommands) {
  bot.command(command, (ctx) => handler(ctx, core, chatId));
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/lab3/Desktop/agi/OpenACP && pnpm build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
cd /Users/lab3/Desktop/agi/OpenACP
git add src/adapters/telegram/commands/index.ts
git commit -m "feat: register plugin commands dynamically in Telegram adapter"
```

---

### Task 5: Remove hardcoded cowork from OpenACPCore

**Files:**
- Modify: `src/core/core.ts` — Remove cowork imports, coworkStore, coworkBridges, and all cowork methods
- Modify: `src/adapters/telegram/commands/index.ts` — Remove hardcoded /cowork handler
- Modify: `src/adapters/telegram/commands/cowork.ts` — Delete file (moves to @openacp/cowork)

**Important:** This task must happen AFTER the plugin system is in place and @openacp/cowork provides the same functionality as a plugin.

- [ ] **Step 1: Remove cowork imports and fields from core.ts**

Remove these imports:
```typescript
import { CoworkGroup } from "./cowork-group.js";
import { CoworkStore } from "./cowork-store.js";
import { CoworkBridge } from "./cowork-bridge.js";
import { buildCoworkSystemPrompt } from "./cowork-prompt.js";
```

Remove fields: `coworkStore`, `coworkBridges`

Remove methods: `createCoworkGroup`, `getCoworkGroup`, `getCoworkGroupForSession`, `listCoworkGroups`, `endCoworkGroup`, `restoreCoworkBridge`, `resumeCoworkMembers`

Keep the cowork source files (`cowork-group.ts`, `cowork-bridge.ts`, etc.) — they're still exported from the package for @openacp/cowork to import.

- [ ] **Step 2: Remove /cowork from Telegram command registration**

In `src/adapters/telegram/commands/index.ts`, remove the line:
```typescript
bot.command("cowork", (ctx) => handleCowork(ctx, core, chatId));
```

And the import of `handleCowork`.

- [ ] **Step 3: Delete the Telegram cowork command file**

```bash
rm src/adapters/telegram/commands/cowork.ts
```

- [ ] **Step 4: Update lazy resume to use plugin hook**

In `core.ts`, the `lazyResume` method calls `this.restoreCoworkBridge()`. Replace with a plugin hook:

```typescript
// In lazyResume, replace:
//   if (record.coworkGroupId) {
//     this.restoreCoworkBridge(record.coworkGroupId, session);
//   }
// With:
if (record.coworkGroupId) {
  this.emit("session:resumed", { session, coworkGroupId: record.coworkGroupId });
}
```

Add event emission capability by extending TypedEmitter or adding a simple hook:

```typescript
private sessionResumeHooks: Array<(session: Session, record: any) => void> = [];

onSessionResumed(hook: (session: Session, record: any) => void): void {
  this.sessionResumeHooks.push(hook);
}
```

- [ ] **Step 5: Build and run all tests**

Run: `cd /Users/lab3/Desktop/agi/OpenACP && pnpm build && pnpm test`
Expected: PASS (cowork files still exist and export, just not used in core.ts)

- [ ] **Step 6: Commit**

```bash
cd /Users/lab3/Desktop/agi/OpenACP
git add -A
git commit -m "refactor: remove hardcoded cowork from core — now loaded as plugin"
```

---

### Task 6: Create CoworkOrchestrator in @openacp/cowork

**Files:**
- Create: `src/cowork-orchestrator.ts`
- Test: `src/__tests__/cowork-orchestrator.test.ts`

This is the logic extracted from `OpenACPCore.createCoworkGroup()` etc., but as a standalone class that receives `core` via constructor.

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/cowork-orchestrator.test.ts
import { describe, it, expect, vi } from "vitest";
import { CoworkOrchestrator } from "../cowork-orchestrator.js";

describe("CoworkOrchestrator", () => {
  it("initializes with core reference", () => {
    const mockCore = { configManager: { get: () => ({ cowork: { maxAgentsPerGroup: 5, statusLogSize: 50, contextInjectionLimit: 10 } }) } };
    const orchestrator = new CoworkOrchestrator(mockCore as any, "/tmp/cowork-store.json");
    expect(orchestrator).toBeDefined();
  });

  it("listGroups returns empty array initially", () => {
    const mockCore = { configManager: { get: () => ({ cowork: { maxAgentsPerGroup: 5, statusLogSize: 50, contextInjectionLimit: 10 } }) } };
    const orchestrator = new CoworkOrchestrator(mockCore as any, "/tmp/test-store.json");
    expect(orchestrator.listGroups()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lab3/Desktop/agi/openacp-cowork && npx vitest run src/__tests__/cowork-orchestrator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CoworkOrchestrator**

```typescript
// src/cowork-orchestrator.ts
import path from "node:path";
import fs from "node:fs/promises";
import type { OpenACPCore, Session, ChannelAdapter } from "openacp/dist/index.js";
import { createChildLogger } from "openacp/dist/index.js";
import { CoworkGroup } from "./cowork-group.js";
import { CoworkStore } from "./cowork-store.js";
import { CoworkBridge } from "./cowork-bridge.js";
import { buildCoworkSystemPrompt } from "./cowork-prompt.js";

const log = createChildLogger({ module: "cowork-orchestrator" });

export class CoworkOrchestrator {
  private store: CoworkStore;
  private bridges: Map<string, CoworkBridge> = new Map();
  private core: OpenACPCore;

  constructor(core: OpenACPCore, storePath: string) {
    this.core = core;
    this.store = new CoworkStore(storePath);
  }

  async createGroup(params: {
    channelId: string;
    name: string;
    threadId: string;
    members: Array<{ agentName: string; role?: string; workingDirectory: string }>;
  }): Promise<{ group: CoworkGroup; sessions: Session[] }> {
    const config = this.core.configManager.get();
    if (params.members.length > config.cowork.maxAgentsPerGroup) {
      throw new Error(`Max ${config.cowork.maxAgentsPerGroup} agents per cowork group`);
    }

    const group = new CoworkGroup({
      name: params.name,
      channelId: params.channelId,
      threadId: params.threadId,
      maxStatusLogSize: config.cowork.statusLogSize,
    });

    const baseWorkspace = params.members[0]?.workingDirectory ?? ".";
    const groupWorkspace = path.join(baseWorkspace, `cowork-${group.id}`);
    await fs.mkdir(path.join(groupWorkspace, "status"), { recursive: true });
    group.workspacePath = groupWorkspace;

    const adapter = this.core.adapters.get(params.channelId);
    const sessions: Session[] = [];

    for (const member of params.members) {
      const session = await this.core.createSession({
        channelId: params.channelId,
        agentName: member.agentName,
        workingDirectory: groupWorkspace,
        createThread: true,
        initialName: member.role ? `${member.agentName} — ${member.role}` : member.agentName,
      });

      group.addMember({
        sessionId: session.id,
        agentName: member.agentName,
        role: member.role,
      });

      this.core.sessionManager.patchRecord(session.id, { coworkGroupId: group.id });
      sessions.push(session);
    }

    if (adapter) {
      const bridge = new CoworkBridge(group, this.core.sessionManager, adapter, {
        contextInjectionLimit: config.cowork.contextInjectionLimit,
      });
      bridge.connect();
      this.bridges.set(group.id, bridge);

      for (const session of sessions) {
        session.coworkBridge = bridge;
      }
    }

    await this.store.save(group);
    log.info({ groupId: group.id, name: group.name, memberCount: params.members.length }, "Cowork group created");

    return { group, sessions };
  }

  getGroup(groupId: string): CoworkGroup | undefined {
    return this.store.get(groupId);
  }

  getGroupForSession(sessionId: string): CoworkGroup | undefined {
    return this.store.findBySessionId(sessionId);
  }

  listGroups(): CoworkGroup[] {
    return this.store.list();
  }

  async endGroup(groupId: string): Promise<void> {
    const bridge = this.bridges.get(groupId);
    if (bridge) {
      bridge.disconnect();
      this.bridges.delete(groupId);
    }

    const group = this.store.get(groupId);
    if (group) {
      for (const [sessionId] of group.members) {
        const session = this.core.sessionManager.getSession(sessionId);
        if (session) session.coworkBridge = null;
      }
    }

    await this.store.remove(groupId);
    log.info({ groupId }, "Cowork group ended");
  }

  restoreBridge(groupId: string, session: Session): void {
    const group = this.store.get(groupId);
    if (!group) return;

    let bridge = this.bridges.get(groupId);
    if (!bridge) {
      const adapter = this.core.adapters.get(group.channelId);
      if (!adapter) return;

      const config = this.core.configManager.get();
      bridge = new CoworkBridge(group, this.core.sessionManager, adapter, {
        contextInjectionLimit: config.cowork.contextInjectionLimit,
      });
      this.bridges.set(groupId, bridge);
      bridge.connect();
      log.info({ groupId, groupName: group.name }, "Cowork bridge restored");
    } else {
      bridge.wireSession(session.id);
    }

    session.coworkBridge = bridge;
  }

  destroy(): void {
    for (const bridge of this.bridges.values()) {
      bridge.disconnect();
    }
    this.bridges.clear();
    this.store.destroy();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lab3/Desktop/agi/openacp-cowork && npx vitest run src/__tests__/cowork-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/lab3/Desktop/agi/openacp-cowork
git add src/cowork-orchestrator.ts src/__tests__/cowork-orchestrator.test.ts
git commit -m "feat: add CoworkOrchestrator — group lifecycle management"
```

---

### Task 7: Create the CorePlugin export for @openacp/cowork

**Files:**
- Create: `src/plugin.ts`
- Modify: `src/index.ts`
- Modify: `package.json` — add `plugin` entry
- Test: `src/__tests__/plugin.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/plugin.test.ts
import { describe, it, expect, vi } from "vitest";
import { coworkPlugin } from "../plugin.js";

describe("coworkPlugin", () => {
  it("has correct name and version", () => {
    expect(coworkPlugin.name).toBe("cowork");
    expect(coworkPlugin.version).toBeDefined();
  });

  it("has register function", () => {
    expect(typeof coworkPlugin.register).toBe("function");
  });

  it("registers /cowork command", () => {
    expect(coworkPlugin.commands).toBeDefined();
    expect(coworkPlugin.commands!.some(c => c.name === "cowork")).toBe(true);
  });

  it("has Telegram-specific adapter commands", () => {
    expect(coworkPlugin.adapterCommands?.telegram).toBeDefined();
    expect(coworkPlugin.adapterCommands!.telegram.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lab3/Desktop/agi/openacp-cowork && npx vitest run src/__tests__/plugin.test.ts`
Expected: FAIL

- [ ] **Step 3: Create the plugin entry**

```typescript
// src/plugin.ts
import os from "node:os";
import path from "node:path";
import type { CorePlugin } from "openacp/dist/index.js";
import { CoworkOrchestrator } from "./cowork-orchestrator.js";
import { handleTelegramCowork } from "./commands/telegram-cowork.js";

let orchestrator: CoworkOrchestrator | null = null;

export function getOrchestrator(): CoworkOrchestrator {
  if (!orchestrator) throw new Error("Cowork plugin not registered yet");
  return orchestrator;
}

export const coworkPlugin: CorePlugin = {
  name: "cowork",
  version: "0.1.0",

  async register(core) {
    const storePath = path.join(os.homedir(), ".openacp", "cowork-groups.json");
    orchestrator = new CoworkOrchestrator(core, storePath);

    // Hook into session resume to restore cowork bridges
    if (typeof core.onSessionResumed === "function") {
      core.onSessionResumed((session: any, record: any) => {
        if (record.coworkGroupId) {
          orchestrator!.restoreBridge(record.coworkGroupId, session);
        }
      });
    }
  },

  async unregister() {
    orchestrator?.destroy();
    orchestrator = null;
  },

  commands: [
    {
      name: "cowork",
      description: "Manage multi-agent collaboration groups",
      usage: '/cowork "Group Name" agent1:role1 agent2:role2',
    },
  ],

  adapterCommands: {
    telegram: [
      {
        command: "cowork",
        handler: (ctx: any, core: any, chatId: any) =>
          handleTelegramCowork(ctx, core, chatId, getOrchestrator()),
      },
    ],
  },
};
```

- [ ] **Step 4: Create Telegram-specific command handler**

Create directory and file:

```bash
mkdir -p src/commands
```

```typescript
// src/commands/telegram-cowork.ts
import type { CoworkOrchestrator } from "../cowork-orchestrator.js";
import { buildCoworkSystemPrompt } from "../cowork-prompt.js";
import { createChildLogger } from "openacp/dist/index.js";

const log = createChildLogger({ module: "cowork-cmd-telegram" });

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function handleTelegramCowork(
  ctx: any,
  core: any,
  chatId: number,
  orchestrator: CoworkOrchestrator,
): Promise<void> {
  const rawMatch = ctx.match;
  const matchStr = typeof rawMatch === "string" ? rawMatch : "";
  const trimmed = matchStr.trim();

  if (trimmed === "status" || trimmed === "list") {
    await handleStatus(ctx, orchestrator);
    return;
  }

  if (trimmed.startsWith("end")) {
    await handleEnd(ctx, core, chatId, orchestrator, trimmed.replace(/^end\s*/, "").trim());
    return;
  }

  if (trimmed.length === 0) {
    await ctx.reply(
      "<b>Usage:</b>\n" +
      '<code>/cowork "Group Name" agent1:role1 agent2:role2</code>\n' +
      "<code>/cowork status</code> — list active groups\n" +
      "<code>/cowork end</code> — end a cowork group",
      { parse_mode: "HTML" },
    );
    return;
  }

  await handleNew(ctx, core, chatId, orchestrator, trimmed);
}

function parseArgs(input: string): { name: string; memberSpecs: string[] } | null {
  let name: string;
  let rest: string;

  const quotedMatch = input.match(/^"([^"]+)"\s*(.*)/);
  if (quotedMatch) {
    name = quotedMatch[1];
    rest = quotedMatch[2];
  } else {
    const parts = input.split(/\s+/);
    name = parts[0];
    rest = parts.slice(1).join(" ");
  }

  if (!name) return null;
  return { name, memberSpecs: rest.split(/\s+/).filter(Boolean) };
}

function parseMemberSpec(spec: string): { agentName: string; role?: string } {
  const idx = spec.indexOf(":");
  if (idx === -1) return { agentName: spec };
  return { agentName: spec.slice(0, idx), role: spec.slice(idx + 1) || undefined };
}

async function handleNew(
  ctx: any, core: any, chatId: number,
  orchestrator: CoworkOrchestrator, args: string,
): Promise<void> {
  const parsed = parseArgs(args);
  if (!parsed || parsed.memberSpecs.length === 0) {
    await ctx.reply('Usage: <code>/cowork "Group Name" agent1:role1 agent2:role2</code>', { parse_mode: "HTML" });
    return;
  }

  const { name: groupName, memberSpecs } = parsed;
  const members: Array<{ agentName: string; role?: string }> = [];

  for (const spec of memberSpecs) {
    const { agentName, role } = parseMemberSpec(spec);
    const agentDef = core.agentCatalog.resolve(agentName);
    if (!agentDef) {
      await ctx.reply(`Agent <b>${escapeHtml(agentName)}</b> not found.`, { parse_mode: "HTML" });
      return;
    }
    members.push({ agentName, role });
  }

  const workspace = core.configManager.resolveWorkspace();

  let threadId: number;
  try {
    const topic = await ctx.api.createForumTopic(chatId, `\u{1F91D} Cowork: ${groupName}`);
    threadId = topic.message_thread_id;
  } catch (err) {
    log.error({ err }, "Failed to create cowork forum topic");
    await ctx.reply(`Failed to create cowork topic: ${escapeHtml(String(err))}`, { parse_mode: "HTML" });
    return;
  }

  try {
    const { group, sessions } = await orchestrator.createGroup({
      channelId: "telegram",
      name: groupName,
      threadId: String(threadId),
      members: members.map(m => ({ ...m, workingDirectory: workspace })),
    });

    const memberLines = members.map(m => {
      const rolePart = m.role ? ` (<i>${escapeHtml(m.role)}</i>)` : "";
      return `  - <b>${escapeHtml(m.agentName)}</b>${rolePart}`;
    }).join("\n");

    try {
      await ctx.api.sendMessage(chatId,
        `<b>Cowork group started:</b> ${escapeHtml(groupName)}\n\n` +
        `<b>Members:</b>\n${memberLines}\n\n` +
        `<b>Workspace:</b> <code>${escapeHtml(group.workspacePath ?? workspace)}</code>\n\n` +
        `Each agent has its own session topic. Status updates will be shared here.\n` +
        `Use <code>/cowork end</code> in this topic to end the group.`,
        { message_thread_id: threadId, parse_mode: "HTML" },
      );
    } catch { /* non-fatal */ }

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const member = members[i];
      const otherMembers = members.filter((_, idx) => idx !== i).map(m => ({ agentName: m.agentName, role: m.role }));

      const systemPrompt = buildCoworkSystemPrompt({
        agentName: member.agentName,
        role: member.role,
        groupName,
        workspacePath: group.workspacePath,
        otherMembers,
      });

      session.enqueuePrompt(systemPrompt).catch(err => {
        log.error({ err, sessionId: session.id }, "Failed to inject cowork system prompt");
      });
    }

    await ctx.reply(`Cowork group <b>${escapeHtml(groupName)}</b> created with ${sessions.length} agent(s).`, { parse_mode: "HTML" });
  } catch (err) {
    log.error({ err }, "Failed to create cowork group");
    try { await ctx.api.deleteForumTopic(chatId, threadId); } catch { /* best effort */ }
    await ctx.reply(`Failed to create cowork group: ${escapeHtml(String(err))}`, { parse_mode: "HTML" });
  }
}

async function handleStatus(ctx: any, orchestrator: CoworkOrchestrator): Promise<void> {
  const groups = orchestrator.listGroups();
  if (groups.length === 0) {
    await ctx.reply("No active cowork groups.", { parse_mode: "HTML" });
    return;
  }

  const lines = groups.map(group => {
    const memberList = Array.from(group.members.values())
      .map(m => `${escapeHtml(m.agentName)}${m.role ? ` (${escapeHtml(m.role)})` : ""}`)
      .join(", ");
    return `<b>${escapeHtml(group.name)}</b> — ${group.members.size} member(s)\n  ${memberList}\n  ID: <code>${escapeHtml(group.id)}</code>`;
  });

  await ctx.reply(`<b>Active Cowork Groups:</b>\n\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
}

async function handleEnd(
  ctx: any, core: any, chatId: number,
  orchestrator: CoworkOrchestrator, groupIdArg: string,
): Promise<void> {
  const groups = orchestrator.listGroups();
  if (groups.length === 0) {
    await ctx.reply("No active cowork groups to end.", { parse_mode: "HTML" });
    return;
  }

  let groupId = groupIdArg;
  if (!groupId) {
    const currentThreadId = ctx.message?.message_thread_id;
    if (currentThreadId) {
      const found = groups.find(g => g.threadId === String(currentThreadId));
      if (found) groupId = found.id;
    }
  }

  if (!groupId) {
    const lines = groups.map(g => `  <code>/cowork end ${escapeHtml(g.id)}</code> — ${escapeHtml(g.name)}`);
    await ctx.reply(`<b>Which group to end?</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
    return;
  }

  const group = groups.find(g => g.id === groupId);
  if (!group) {
    await ctx.reply(`Cowork group <code>${escapeHtml(groupId)}</code> not found.`, { parse_mode: "HTML" });
    return;
  }

  try {
    await orchestrator.endGroup(groupId);
    try {
      await ctx.api.sendMessage(chatId, `Cowork group <b>${escapeHtml(group.name)}</b> has been ended.`,
        { message_thread_id: Number(group.threadId), parse_mode: "HTML" });
    } catch { /* topic may be deleted */ }
    await ctx.reply(`Cowork group <b>${escapeHtml(group.name)}</b> ended.`, { parse_mode: "HTML" });
  } catch (err) {
    log.error({ err, groupId }, "Failed to end cowork group");
    await ctx.reply(`Failed to end cowork group: ${escapeHtml(String(err))}`, { parse_mode: "HTML" });
  }
}
```

- [ ] **Step 5: Update index.ts and package.json**

In `src/index.ts`, add:

```typescript
export { coworkPlugin, getOrchestrator } from "./plugin.js";
export { CoworkOrchestrator } from "./cowork-orchestrator.js";
```

In `package.json`, add field:

```json
"plugin": "dist/plugin.js"
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/lab3/Desktop/agi/openacp-cowork && npx vitest run src/__tests__/plugin.test.ts`
Expected: PASS

- [ ] **Step 7: Build full project**

Run: `cd /Users/lab3/Desktop/agi/openacp-cowork && npx tsc`
Expected: Clean build

- [ ] **Step 8: Commit**

```bash
cd /Users/lab3/Desktop/agi/openacp-cowork
git add -A
git commit -m "feat: CorePlugin entry point with Telegram command handler"
```

---

### Task 8: End-to-end integration test

**Files:**
- Create: `src/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// src/__tests__/integration.test.ts
import { describe, it, expect, vi } from "vitest";
import { coworkPlugin } from "../plugin.js";
import { CoworkOrchestrator } from "../cowork-orchestrator.js";

describe("cowork plugin integration", () => {
  it("register creates orchestrator and hooks into core", async () => {
    const onSessionResumed = vi.fn();
    const mockCore = {
      configManager: {
        get: () => ({
          cowork: { maxAgentsPerGroup: 5, statusLogSize: 50, contextInjectionLimit: 10 },
        }),
      },
      adapters: new Map(),
      sessionManager: { getSession: vi.fn() },
      onSessionResumed,
    };

    await coworkPlugin.register(mockCore);

    // Orchestrator should be accessible
    const { getOrchestrator } = await import("../plugin.js");
    const orchestrator = getOrchestrator();
    expect(orchestrator).toBeInstanceOf(CoworkOrchestrator);

    // Session resume hook should be registered
    expect(onSessionResumed).toHaveBeenCalled();
  });

  it("unregister cleans up", async () => {
    await coworkPlugin.unregister!();
    const { getOrchestrator } = await import("../plugin.js");
    expect(() => getOrchestrator()).toThrow("not registered");
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/lab3/Desktop/agi/openacp-cowork && npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Run OpenACP tests too**

Run: `cd /Users/lab3/Desktop/agi/OpenACP && pnpm test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/lab3/Desktop/agi/openacp-cowork
git add src/__tests__/integration.test.ts
git commit -m "test: add integration test for cowork plugin lifecycle"
```

---

## Execution Order

Tasks 1-4 modify **OpenACP** (add plugin system).
Task 5 modifies **OpenACP** (remove hardcoded cowork).
Tasks 6-8 modify **@openacp/cowork** (add orchestrator + plugin).

Tasks 1-4 can be done first, then Task 5 and Tasks 6-8 can be done in parallel (different repos). Task 8 requires both sides to be done.

## User Configuration After Implementation

User adds to `~/.openacp/config.json`:

```json
{
  "plugins": ["@openacp/cowork"]
}
```

And installs:

```bash
openacp install @openacp/cowork
```

Then `/cowork` command works exactly as before, but served by the plugin.
