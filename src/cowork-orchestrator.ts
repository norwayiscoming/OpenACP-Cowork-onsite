import path from "node:path";
import fs from "node:fs/promises";
import { CoworkGroup } from "./cowork-group.js";
import { CoworkStore } from "./cowork-store.js";
import { CoworkBridge, type CoworkBridgeDeps } from "./cowork-bridge.js";
import { buildCoworkSystemPrompt } from "./cowork-prompt.js";
import type { PluginContext } from "@openacp/cli";

type Logger = PluginContext["log"];

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

interface CoworkConfig {
  maxAgentsPerGroup: number;
  statusLogSize: number;
  contextInjectionLimit: number;
}

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

  async init(): Promise<void> {
    await this.store.load();
  }

  private getConfig(): CoworkConfig {
    return {
      maxAgentsPerGroup: (this.pluginConfig.maxAgentsPerGroup as number) ?? 5,
      statusLogSize: (this.pluginConfig.statusLogSize as number) ?? 50,
      contextInjectionLimit: (this.pluginConfig.contextInjectionLimit as number) ?? 10,
    };
  }

  private makeBridgeDeps(): CoworkBridgeDeps {
    const config = this.getConfig();
    return {
      log: this.log,
      contextInjectionLimit: config.contextInjectionLimit,
      sendMessage: async (threadId, content) => {
        for (const adapter of this.core.adapters.values()) {
          try {
            await adapter.sendMessage(threadId, content);
            return;
          } catch { /* try next */ }
        }
      },
      enqueuePrompt: async (sessionId, text) => {
        const session = this.core.sessionManager.getSession(sessionId);
        if (session) await session.enqueuePrompt(text);
      },
      getSessionStatus: (sessionId) => {
        return this.core.sessionManager.getSession(sessionId)?.status;
      },
    };
  }

  async createGroup(params: {
    channelId: string;
    name: string;
    threadId: string;
    members: Array<{ agentName: string; role?: string; workingDirectory: string }>;
  }): Promise<{ group: CoworkGroup; sessions: Array<{ id: string; enqueuePrompt(text: string): Promise<void> }> }> {
    const config = this.getConfig();
    if (params.members.length > config.maxAgentsPerGroup) {
      throw new Error(`Max ${config.maxAgentsPerGroup} agents per cowork group`);
    }

    const group = new CoworkGroup({
      name: params.name,
      channelId: params.channelId,
      threadId: params.threadId,
      maxStatusLogSize: config.statusLogSize,
    });

    const baseWorkspace = params.members[0]?.workingDirectory ?? ".";
    const groupWorkspace = path.join(baseWorkspace, `cowork-${group.id}`);
    await fs.mkdir(path.join(groupWorkspace, "status"), { recursive: true });
    group.workspacePath = groupWorkspace;

    const sessions: Array<{ id: string; enqueuePrompt(text: string): Promise<void> }> = [];

    for (const member of params.members) {
      const session = await this.core.createSession({
        channelId: params.channelId,
        agentName: member.agentName,
        workingDirectory: groupWorkspace,
        createThread: true,
        initialName: member.role ? `${member.agentName} \u2014 ${member.role}` : member.agentName,
      });

      group.addMember({
        sessionId: session.id,
        agentName: member.agentName,
        role: member.role,
      });

      this.core.sessionManager.patchRecord(session.id, { coworkGroupId: group.id });
      sessions.push(session);
    }

    const bridge = new CoworkBridge(group, this.makeBridgeDeps());
    this.bridges.set(group.id, bridge);

    await this.store.save(group);
    this.log.info(`Cowork group created: ${group.id} "${group.name}" with ${params.members.length} members`);

    return { group, sessions };
  }

  getGroup(groupId: string): CoworkGroup | undefined {
    return this.store.get(groupId);
  }

  getGroupForSession(sessionId: string): CoworkGroup | undefined {
    return this.store.findBySessionId(sessionId);
  }

  getBridge(groupId: string): CoworkBridge | undefined {
    return this.bridges.get(groupId);
  }

  getBridgeForSession(sessionId: string): CoworkBridge | undefined {
    for (const bridge of this.bridges.values()) {
      if (bridge.hasSession(sessionId)) return bridge;
    }
    return undefined;
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
    await this.store.remove(groupId);
    this.log.info(`Cowork group ended: ${groupId}`);
  }

  restoreBridge(groupId: string, sessionId: string): void {
    const group = this.store.get(groupId);
    if (!group) return;

    let bridge = this.bridges.get(groupId);
    if (!bridge) {
      bridge = new CoworkBridge(group, this.makeBridgeDeps());
      this.bridges.set(groupId, bridge);
      this.log.info(`Cowork bridge restored: ${groupId} "${group.name}"`);
    } else {
      bridge.addMemberSession(sessionId);
    }
  }

  destroy(): void {
    for (const bridge of this.bridges.values()) {
      bridge.disconnect();
    }
    this.bridges.clear();
  }
}
