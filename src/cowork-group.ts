import { nanoid } from "nanoid";
import type { StatusEntry, CoworkGroupRecord, CoworkMemberRecord } from "./types.js";

export interface CoworkMember {
  sessionId: string;
  agentName: string;
  role?: string;
  joinedAt: Date;
  currentFiles: Set<string>;
}

export class CoworkGroup {
  readonly id: string;
  name: string;
  channelId: string;
  threadId: string;
  groupThreadId?: string;
  workspacePath?: string;
  members: Map<string, CoworkMember> = new Map();
  statusLog: StatusEntry[] = [];
  createdAt: Date;
  private maxStatusLogSize: number;

  constructor(opts: {
    id?: string;
    name: string;
    channelId: string;
    threadId: string;
    maxStatusLogSize?: number;
    createdAt?: Date;
  }) {
    this.id = opts.id ?? nanoid(12);
    this.name = opts.name;
    this.channelId = opts.channelId;
    this.threadId = opts.threadId;
    this.maxStatusLogSize = opts.maxStatusLogSize ?? 50;
    this.createdAt = opts.createdAt ?? new Date();
  }

  addMember(opts: { sessionId: string; agentName: string; role?: string }): void {
    this.members.set(opts.sessionId, {
      sessionId: opts.sessionId,
      agentName: opts.agentName,
      role: opts.role,
      joinedAt: new Date(),
      currentFiles: new Set(),
    });
  }

  removeMember(sessionId: string): void {
    this.members.delete(sessionId);
  }

  appendStatus(entry: StatusEntry): void {
    this.statusLog.push(entry);
    while (this.statusLog.length > this.maxStatusLogSize) {
      this.statusLog.shift();
    }
  }

  getRecentStatuses(excludeSessionId: string, limit: number): StatusEntry[] {
    return this.statusLog
      .filter(s => s.sessionId !== excludeSessionId)
      .slice(-limit);
  }

  toRecord(): CoworkGroupRecord {
    const members: CoworkMemberRecord[] = [];
    for (const [, m] of this.members) {
      members.push({
        sessionId: m.sessionId,
        agentName: m.agentName,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        currentFiles: [...m.currentFiles],
      });
    }
    return {
      id: this.id,
      name: this.name,
      channelId: this.channelId,
      threadId: this.threadId,
      groupThreadId: this.groupThreadId,
      workspacePath: this.workspacePath,
      members,
      statusLog: this.statusLog,
      createdAt: this.createdAt.toISOString(),
    };
  }

  static fromRecord(record: CoworkGroupRecord): CoworkGroup {
    const group = new CoworkGroup({
      id: record.id,
      name: record.name,
      channelId: record.channelId,
      threadId: record.threadId,
      createdAt: new Date(record.createdAt),
    });
    group.workspacePath = record.workspacePath;
    group.groupThreadId = record.groupThreadId;
    for (const m of record.members) {
      group.members.set(m.sessionId, {
        sessionId: m.sessionId,
        agentName: m.agentName,
        role: m.role,
        joinedAt: new Date(m.joinedAt),
        currentFiles: new Set(m.currentFiles),
      });
    }
    group.statusLog = record.statusLog;
    return group;
  }
}
