import { describe, it, expect, vi, beforeEach } from "vitest";
import { CoworkBridge, type CoworkBridgeDeps } from "../cowork-bridge.js";
import { CoworkGroup } from "../cowork-group.js";

function mockDeps(overrides?: Partial<CoworkBridgeDeps>): CoworkBridgeDeps {
  return {
    log: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() } as any,
    contextInjectionLimit: 10,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    enqueuePrompt: vi.fn().mockResolvedValue(undefined),
    getSessionStatus: vi.fn().mockReturnValue("active"),
    ...overrides,
  };
}

function makeGroup(): CoworkGroup {
  const g = new CoworkGroup({ name: "test", channelId: "telegram", threadId: "t1" });
  g.workspacePath = "/tmp/cowork-test";
  g.groupThreadId = "group-thread-1";
  g.addMember({ sessionId: "s1", agentName: "claude", role: "backend" });
  g.addMember({ sessionId: "s2", agentName: "cursor", role: "frontend" });
  return g;
}

describe("CoworkBridge", () => {
  let deps: CoworkBridgeDeps;
  let group: CoworkGroup;
  let bridge: CoworkBridge;

  beforeEach(() => {
    deps = mockDeps();
    group = makeGroup();
    bridge = new CoworkBridge(group, deps);
  });

  it("ignores events from non-member sessions", () => {
    bridge.handleAgentEvent("unknown", { type: "text", content: "hello" } as any);
    bridge.handleTurnEnd("unknown");
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it("does NOT auto-broadcast text-only turns", () => {
    bridge.handleAgentEvent("s1", { type: "text", content: "Built the API endpoint for users" } as any);
    bridge.handleTurnEnd("s1");
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.enqueuePrompt).not.toHaveBeenCalled();
  });

  it("broadcasts [STATUS] on turn end and notifies other agents", () => {
    bridge.handleAgentEvent("s1", { type: "text", content: "[STATUS]\nDONE: built API\n" } as any);
    // Not broadcast yet — waiting for turn end
    expect(deps.sendMessage).not.toHaveBeenCalled();
    bridge.handleTurnEnd("s1");
    // Now broadcast happens with full content
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.enqueuePrompt).toHaveBeenCalledTimes(1);
  });

  it("suppresses notification responses", () => {
    // s1 posts status → turn ends → notifies s2
    bridge.handleAgentEvent("s1", { type: "text", content: "[STATUS]\nDONE: built auth API\n" } as any);
    bridge.handleTurnEnd("s1");
    expect(deps.enqueuePrompt).toHaveBeenCalledTimes(1);

    // s2 responds to notification with [STATUS] → should NOT broadcast
    bridge.handleAgentEvent("s2", { type: "text", content: "[STATUS]\nAcknowledged\n" } as any);
    bridge.handleTurnEnd("s2");
    // sendMessage called once for s1's status, NOT for s2's notification response
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not broadcast short content even with [STATUS]", () => {
    bridge.handleAgentEvent("s1", { type: "text", content: "[STATUS]\n" } as any);
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it("builds cowork context", () => {
    group.appendStatus({
      id: "1", sessionId: "s1", agentName: "claude", role: "backend",
      timestamp: new Date().toISOString(), content: "Built API", type: "progress",
    });
    const ctx = bridge.buildCoworkContext("s2");
    expect(ctx).toContain("claude (backend)");
    expect(ctx).toContain("Built API");
  });

  it("returns empty context for non-member", () => {
    expect(bridge.buildCoworkContext("unknown")).toBe("");
  });

  it("does NOT broadcast tool calls without explicit [STATUS]", () => {
    bridge.handleAgentEvent("s1", { type: "tool_call", name: "write_file", status: "completed" } as any);
    bridge.handleAgentEvent("s1", { type: "text", content: "Created the user model file" } as any);
    bridge.handleTurnEnd("s1");
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });
});
