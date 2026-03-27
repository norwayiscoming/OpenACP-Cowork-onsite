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

  it("auto-broadcasts on turn end with accumulated text", () => {
    bridge.handleAgentEvent("s1", { type: "text", content: "Built the API endpoint for users" } as any);
    bridge.handleTurnEnd("s1");
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.enqueuePrompt).toHaveBeenCalledTimes(1);
  });

  it("broadcasts explicit [STATUS] immediately", () => {
    bridge.handleAgentEvent("s1", { type: "text", content: "[STATUS]\nDONE: built API\n" } as any);
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    bridge.handleTurnEnd("s1");
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("suppresses notification loop", () => {
    bridge.handleAgentEvent("s1", { type: "text", content: "Built the API endpoint for auth" } as any);
    bridge.handleTurnEnd("s1");
    expect(deps.enqueuePrompt).toHaveBeenCalledTimes(1);

    bridge.handleAgentEvent("s2", { type: "text", content: "Acknowledged the API update" } as any);
    bridge.handleTurnEnd("s2");
  });

  it("skips auto-broadcast for short content", () => {
    bridge.handleAgentEvent("s1", { type: "text", content: "ok" } as any);
    bridge.handleTurnEnd("s1");
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

  it("tracks tool calls in auto-status", () => {
    bridge.handleAgentEvent("s1", { type: "tool_call", name: "write_file", status: "completed" } as any);
    bridge.handleAgentEvent("s1", { type: "text", content: "Created the user model file" } as any);
    bridge.handleTurnEnd("s1");
    const call = (deps.sendMessage as any).mock.calls[0];
    expect(call[1].text).toContain("write_file");
  });
});
