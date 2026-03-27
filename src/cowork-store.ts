import { CoworkGroup } from "./cowork-group.js";
import type { CoworkGroupRecord } from "./types.js";
import type { PluginStorage, PluginContext } from "@openacp/cli";

type Logger = PluginContext["log"];

interface StoreData {
  version: number;
  groups: Record<string, CoworkGroupRecord>;
}

export class CoworkStore {
  private groups: Map<string, CoworkGroup> = new Map();
  private saving = false;
  private pendingSave = false;

  constructor(
    private storage: PluginStorage,
    private log: Logger,
  ) {}

  async load(): Promise<void> {
    const data = await this.storage.get<StoreData>("groups");
    if (!data || data.version !== 1) return;
    for (const [id, record] of Object.entries(data.groups)) {
      this.groups.set(id, CoworkGroup.fromRecord(record));
    }
    this.log.info(`Loaded ${this.groups.size} cowork groups`);
  }

  async save(group: CoworkGroup): Promise<void> {
    this.groups.set(group.id, group);
    await this.persist();
  }

  get(groupId: string): CoworkGroup | undefined {
    return this.groups.get(groupId);
  }

  findBySessionId(sessionId: string): CoworkGroup | undefined {
    for (const group of this.groups.values()) {
      if (group.members.has(sessionId)) return group;
    }
    return undefined;
  }

  findByThread(channelId: string, threadId: string): CoworkGroup | undefined {
    for (const group of this.groups.values()) {
      if (group.channelId === channelId && group.threadId === threadId) return group;
    }
    return undefined;
  }

  list(): CoworkGroup[] {
    return [...this.groups.values()];
  }

  async remove(groupId: string): Promise<void> {
    this.groups.delete(groupId);
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (this.saving) {
      this.pendingSave = true;
      return;
    }
    this.saving = true;
    try {
      const data: StoreData = { version: 1, groups: {} };
      for (const [id, group] of this.groups) {
        data.groups[id] = group.toRecord();
      }
      await this.storage.set("groups", data);
    } finally {
      this.saving = false;
      if (this.pendingSave) {
        this.pendingSave = false;
        await this.persist();
      }
    }
  }
}
