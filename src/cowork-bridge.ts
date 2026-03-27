import path from "node:path";
import fs from "node:fs/promises";
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
  sendMessage: (sessionId: string, content: { type: "text"; text: string }) => Promise<void>;
  enqueuePrompt: (sessionId: string, text: string) => Promise<void>;
  getSessionStatus: (sessionId: string) => string | undefined;
}

export class CoworkBridge {
  private textBuffers: Map<string, string> = new Map();
  private explicitStatusPosted: Set<string> = new Set();
  private toolCallBuffers: Map<string, string[]> = new Map();
  private suppressNotification: Set<string> = new Set();
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

    if (this.group.workspacePath) {
      lines.push(`Status folder: ${path.join(this.group.workspacePath, "status")}`);
    }
    lines.push("Follow decisions made by other agents. Flag conflicts if you see any.");
    return lines.join("\n");
  }

  disconnect(): void {
    this.textBuffers.clear();
    this.explicitStatusPosted.clear();
    this.toolCallBuffers.clear();
    this.suppressNotification.clear();
  }

  private handleToolCallEvent(sessionId: string, event: AgentEvent): void {
    const tools = this.toolCallBuffers.get(sessionId) ?? [];
    const label =
      event.type === "tool_call"
        ? event.name + (event.status === "completed" ? " \u2713" : "")
        : "";
    tools.push(label);
    this.toolCallBuffers.set(sessionId, tools);
  }

  private handleTextEvent(sessionId: string, content: string): void {
    const existing = this.textBuffers.get(sessionId) ?? "";
    const accumulated = existing + content;
    this.textBuffers.set(sessionId, accumulated);

    if (STATUS_PATTERN.test(accumulated) && accumulated.includes("\n")) {
      const statusMatch = accumulated.match(/\[STATUS\]([\s\S]*)/);
      if (statusMatch) {
        const statusContent = statusMatch[1].trim();
        if (statusContent.length > 0) {
          this.broadcastStatus(sessionId, statusContent);
          this.explicitStatusPosted.add(sessionId);
          this.textBuffers.set(sessionId, "");
        }
      }
    }

    if (accumulated.length > 5000 && !STATUS_PATTERN.test(accumulated)) {
      this.textBuffers.set(sessionId, accumulated.slice(-2000));
    }
  }

  private handlePromptComplete(sessionId: string): void {
    const isSuppressed = this.suppressNotification.has(sessionId);
    if (isSuppressed) {
      this.suppressNotification.delete(sessionId);
      this.explicitStatusPosted.delete(sessionId);
      this.textBuffers.set(sessionId, "");
      this.toolCallBuffers.delete(sessionId);
      return;
    }

    if (this.explicitStatusPosted.has(sessionId)) {
      this.explicitStatusPosted.delete(sessionId);
      this.textBuffers.set(sessionId, "");
      this.toolCallBuffers.delete(sessionId);
      return;
    }

    const text = (this.textBuffers.get(sessionId) ?? "").trim();
    const tools = this.toolCallBuffers.get(sessionId) ?? [];

    if (text.length < 10 && tools.length === 0) {
      this.textBuffers.set(sessionId, "");
      this.toolCallBuffers.delete(sessionId);
      return;
    }

    let autoStatus = "";
    if (tools.length > 0) {
      const uniqueTools = [...new Set(tools)];
      autoStatus += `Tools: ${uniqueTools.join(", ")}\n`;
    }
    if (text.length > 0) {
      const truncated =
        text.length > AUTO_STATUS_MAX_LENGTH
          ? text.slice(0, AUTO_STATUS_MAX_LENGTH) + "\u2026"
          : text;
      autoStatus += truncated;
    }

    if (autoStatus.trim().length > 0) {
      this.broadcastStatus(sessionId, autoStatus.trim());
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

    this.writeStatusFile(entry).catch(err =>
      this.deps.log.error(`Failed to write status file: ${err}`),
    );

    const label = member.role
      ? `<b>${member.agentName} (${member.role})</b>`
      : `<b>${member.agentName}</b>`;

    this.deps
      .sendMessage(this.group.threadId, {
        type: "text",
        text: `${label}\n\n${content}`,
      })
      .catch((err: unknown) => this.deps.log.error(`Failed to broadcast status: ${err}`));

    this.deps.log.info(
      `Status broadcast: group=${this.group.id} session=${sessionId} type=${entry.type}`,
    );

    this.notifyOtherAgents(sessionId, entry);
  }

  private async writeStatusFile(entry: StatusEntry): Promise<void> {
    if (!this.group.workspacePath) return;
    const statusDir = path.join(this.group.workspacePath, "status");
    await fs.mkdir(statusDir, { recursive: true });
    const fileName = `${entry.timestamp.replace(/[:.]/g, "-")}_${entry.agentName}_${entry.id}.json`;
    const filePath = path.join(statusDir, fileName);
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2), "utf-8");
  }

  private notifyOtherAgents(fromSessionId: string, entry: StatusEntry): void {
    for (const otherSessionId of this.memberSessionIds) {
      if (otherSessionId === fromSessionId) continue;

      const status = this.deps.getSessionStatus(otherSessionId);
      if (status !== "active") continue;

      const roleLabel = entry.role ? ` (${entry.role})` : "";
      const statusDir = this.group.workspacePath
        ? path.join(this.group.workspacePath, "status")
        : "";

      const notification = [
        `[Cowork Update \u2014 ${entry.agentName}${roleLabel} just completed a task]`,
        "",
        entry.content.length > 500 ? entry.content.slice(0, 500) + "..." : entry.content,
        "",
        statusDir ? `Full status history: ${statusDir}` : "",
        "",
        "If this affects your current work, adapt accordingly. Otherwise, continue with your task.",
      ]
        .filter(Boolean)
        .join("\n");

      this.suppressNotification.add(otherSessionId);

      this.deps.enqueuePrompt(otherSessionId, notification).catch(err => {
        this.suppressNotification.delete(otherSessionId);
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
