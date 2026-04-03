import { nanoid } from "nanoid";
import type { CoworkGroup } from "./cowork-group.js";
import type { StatusEntry, CoworkStatusType } from "./types.js";
import type { AgentEvent, PluginContext } from "@openacp/cli";

type Logger = PluginContext["log"];

const STATUS_PATTERN = /\[STATUS\]/;
const AUTO_STATUS_MAX_LENGTH = 3000;

export interface CoworkBridgeDeps {
  log: Logger;
  contextInjectionLimit: number;
  sendMessage: (threadId: string, content: { type: "text"; text: string }) => Promise<void>;
  enqueuePrompt: (sessionId: string, text: string) => Promise<void>;
  getSessionStatus: (sessionId: string) => string | undefined;
}

export class CoworkBridge {
  private textBuffers: Map<string, string> = new Map();
  private toolCallBuffers: Map<string, string[]> = new Map();
  private pendingNotifications: Map<string, number> = new Map();
  private memberSessionIds: Set<string>;

  constructor(
    private group: CoworkGroup,
    private deps: CoworkBridgeDeps,
  ) {
    this.memberSessionIds = new Set(group.members.keys());
  }

  addMemberSession(sessionId: string): void {
    this.memberSessionIds.add(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.memberSessionIds.has(sessionId);
  }

  handleAgentEvent(sessionId: string, event: AgentEvent): void {
    if (!this.memberSessionIds.has(sessionId)) return;
    if (event.type === "text" && event.content) {
      this.handleTextEvent(sessionId, event.content);
    } else if (event.type === "tool_call" && event.name) {
      this.handleToolCallEvent(sessionId, event);
    }
  }

  handleTurnEnd(sessionId: string): void {
    if (!this.memberSessionIds.has(sessionId)) return;
    this.handlePromptComplete(sessionId);
  }

  buildCoworkContext(sessionId: string): string {
    if (!this.memberSessionIds.has(sessionId)) return "";
    const statuses = this.group.getRecentStatuses(sessionId, this.deps.contextInjectionLimit);
    if (statuses.length === 0) return "";

    const lines = [
      "[Cowork Context — Recent updates from other agents in your group]",
      "",
    ];

    for (const s of statuses) {
      const roleLabel = s.role ? ` (${s.role})` : "";
      const ago = this.timeAgo(new Date(s.timestamp));
      lines.push(`[${s.agentName}${roleLabel} — ${ago}]`);
      lines.push(s.content.length > 500 ? s.content.slice(0, 500) + "..." : s.content);
      lines.push("");
    }

    lines.push("Follow decisions made by other agents. Flag conflicts if you see any.");
    return lines.join("\n");
  }

  disconnect(): void {
    this.textBuffers.clear();
    this.toolCallBuffers.clear();
    this.pendingNotifications.clear();
  }

  private handleToolCallEvent(sessionId: string, event: AgentEvent): void {
    if (event.type !== "tool_call") return;
    const tools = this.toolCallBuffers.get(sessionId) ?? [];
    const label = event.name + (event.status === "completed" ? " \u2713" : "");
    tools.push(label);
    this.toolCallBuffers.set(sessionId, tools);
  }

  private handleTextEvent(sessionId: string, content: string): void {
    const existing = this.textBuffers.get(sessionId) ?? "";
    const accumulated = existing + content;
    this.textBuffers.set(sessionId, accumulated);

    // Trim buffer if too large and no [STATUS] detected
    if (accumulated.length > 5000 && !STATUS_PATTERN.test(accumulated)) {
      this.textBuffers.set(sessionId, accumulated.slice(-2000));
    }
  }

  private handlePromptComplete(sessionId: string): void {
    // If this turn was a notification response, just clean up
    const pending = this.pendingNotifications.get(sessionId) ?? 0;
    if (pending > 0) {
      this.pendingNotifications.set(sessionId, pending - 1);
      this.textBuffers.set(sessionId, "");
      this.toolCallBuffers.delete(sessionId);
      return;
    }

    // Check for [STATUS] block in accumulated text (now that turn is complete)
    const text = (this.textBuffers.get(sessionId) ?? "");
    if (STATUS_PATTERN.test(text)) {
      const statusMatch = text.match(/\[STATUS\]([\s\S]*)/);
      if (statusMatch) {
        const statusContent = statusMatch[1].trim();
        if (statusContent.length > 0) {
          this.broadcastStatus(sessionId, statusContent);
        }
      }
    }

    this.textBuffers.set(sessionId, "");
    this.toolCallBuffers.delete(sessionId);
  }

  private broadcastStatus(sessionId: string, content: string): void {
    const member = this.group.members.get(sessionId);
    if (!member) return;

    const entry: StatusEntry = {
      id: nanoid(8),
      sessionId,
      agentName: member.agentName,
      role: member.role,
      timestamp: new Date().toISOString(),
      content,
      type: this.classifyStatus(content),
      files: this.extractFilesFromStatus(content),
    };

    this.group.appendStatus(entry);

    if (entry.files) {
      for (const file of entry.files) {
        member.currentFiles.add(file);
      }
    }

    // Broadcast to group thread (for human overview)
    if (this.group.groupThreadId) {
      const label = member.role
        ? `[${member.agentName} (${member.role})]`
        : `[${member.agentName}]`;

      this.deps
        .sendMessage(this.group.groupThreadId, {
          type: "text",
          text: `${label}\n\n${content}`,
        })
        .catch((err: unknown) => this.deps.log.error(`Failed to broadcast status: ${err}`));
    }

    this.deps.log.info(
      `Status broadcast: group=${this.group.id} session=${sessionId} type=${entry.type}`,
    );

    // Notify other agents
    this.notifyOtherAgents(sessionId, entry);
  }

  private notifyOtherAgents(fromSessionId: string, entry: StatusEntry): void {
    for (const otherSessionId of this.memberSessionIds) {
      if (otherSessionId === fromSessionId) continue;

      const status = this.deps.getSessionStatus(otherSessionId);
      if (status !== "active" && status !== "idle") continue;

      const roleLabel = entry.role ? ` (${entry.role})` : "";

      const notification = [
        `[Cowork Update — ${entry.agentName}${roleLabel} completed a task]`,
        "",
        entry.content.length > 500 ? entry.content.slice(0, 500) + "..." : entry.content,
        "",
        "Read the update above and report back to the human in this thread:",
        "- Briefly summarize what happened",
        "- If this is relevant to your work, explain how",
        "- Ask the human if they want you to take any action",
        "- If not relevant, just acknowledge and stay idle",
      ].join("\n");

      // Increment pending notification counter for this session
      const current = this.pendingNotifications.get(otherSessionId) ?? 0;
      this.pendingNotifications.set(otherSessionId, current + 1);

      this.deps.enqueuePrompt(otherSessionId, notification).catch(err => {
        const c = this.pendingNotifications.get(otherSessionId) ?? 0;
        if (c > 0) this.pendingNotifications.set(otherSessionId, c - 1);
        this.deps.log.error(`Failed to notify agent ${otherSessionId}: ${err}`);
      });
    }
  }

  private classifyStatus(content: string): CoworkStatusType {
    const lower = content.toLowerCase();
    if (lower.includes("blocker") || lower.includes("blocked")) return "blocker";
    if (lower.includes("decision") || lower.includes("chose")) return "decision";
    if (lower.includes("need") || lower.includes("request")) return "request";
    if (lower.includes("completed") || lower.includes("done")) return "completed";
    return "progress";
  }

  private extractFilesFromStatus(content: string): string[] {
    const filesMatch = content.match(/FILES?:\s*(.*)/i);
    if (!filesMatch) return [];
    return filesMatch[1]
      .split(/[,\n]/)
      .map(f => f.trim())
      .filter(f => f.length > 0 && (f.includes("/") || f.includes(".")));
  }

  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }
}
