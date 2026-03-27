import { describe, it, expect } from "vitest";
import { CoworkGroup } from "../cowork-group.js";

describe("CoworkGroup", () => {
  it("creates with generated id", () => {
    const g = new CoworkGroup({ name: "test", channelId: "telegram", threadId: "t1" });
    expect(g.id).toHaveLength(12);
    expect(g.name).toBe("test");
  });

  it("adds and removes members", () => {
    const g = new CoworkGroup({ name: "test", channelId: "telegram", threadId: "t1" });
    g.addMember({ sessionId: "s1", agentName: "claude", role: "backend" });
    expect(g.members.size).toBe(1);
    expect(g.members.get("s1")?.agentName).toBe("claude");
    g.removeMember("s1");
    expect(g.members.size).toBe(0);
  });

  it("appends status with circular buffer", () => {
    const g = new CoworkGroup({ name: "test", channelId: "telegram", threadId: "t1", maxStatusLogSize: 2 });
    g.appendStatus({ id: "1", sessionId: "s1", agentName: "a", timestamp: "", content: "first", type: "progress" });
    g.appendStatus({ id: "2", sessionId: "s1", agentName: "a", timestamp: "", content: "second", type: "progress" });
    g.appendStatus({ id: "3", sessionId: "s1", agentName: "a", timestamp: "", content: "third", type: "progress" });
    expect(g.statusLog).toHaveLength(2);
    expect(g.statusLog[0].content).toBe("second");
  });

  it("getRecentStatuses excludes given session", () => {
    const g = new CoworkGroup({ name: "test", channelId: "telegram", threadId: "t1" });
    g.appendStatus({ id: "1", sessionId: "s1", agentName: "a", timestamp: "", content: "a", type: "progress" });
    g.appendStatus({ id: "2", sessionId: "s2", agentName: "b", timestamp: "", content: "b", type: "progress" });
    const recent = g.getRecentStatuses("s1", 10);
    expect(recent).toHaveLength(1);
    expect(recent[0].sessionId).toBe("s2");
  });

  it("serializes and deserializes", () => {
    const g = new CoworkGroup({ name: "test", channelId: "telegram", threadId: "t1" });
    g.workspacePath = "/tmp/cowork";
    g.addMember({ sessionId: "s1", agentName: "claude", role: "backend" });
    g.appendStatus({ id: "1", sessionId: "s1", agentName: "claude", timestamp: new Date().toISOString(), content: "done", type: "completed" });

    const record = g.toRecord();
    const restored = CoworkGroup.fromRecord(record);
    expect(restored.id).toBe(g.id);
    expect(restored.members.size).toBe(1);
    expect(restored.statusLog).toHaveLength(1);
    expect(restored.workspacePath).toBe("/tmp/cowork");
  });
});
