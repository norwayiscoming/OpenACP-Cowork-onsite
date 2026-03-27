import { z } from "zod";
import type { OpenACPPlugin, PluginContext, InstallContext, MigrateContext } from "@openacp/cli";
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
