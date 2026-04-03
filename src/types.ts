export type CoworkStatusType = "progress" | "decision" | "blocker" | "request" | "completed";

export interface StatusEntry {
  id: string;
  sessionId: string;
  agentName: string;
  role?: string;
  timestamp: string;
  content: string;
  type: CoworkStatusType;
  files?: string[];
}

export interface CoworkMemberRecord {
  sessionId: string;
  agentName: string;
  role?: string;
  joinedAt: string;
  currentFiles: string[];
}

export interface CoworkGroupRecord {
  id: string;
  name: string;
  channelId: string;
  threadId: string;
  groupThreadId?: string;
  workspacePath?: string;
  members: CoworkMemberRecord[];
  statusLog: StatusEntry[];
  createdAt: string;
}
