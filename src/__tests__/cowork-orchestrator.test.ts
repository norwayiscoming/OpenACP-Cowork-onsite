import { describe, it, expect, vi } from "vitest";
import { CoworkOrchestrator } from "../cowork-orchestrator.js";

describe("CoworkOrchestrator", () => {
  function makeOrchestrator() {
    const mockCtx = {
      core: {
        configManager: {
          get: () => ({}),
        },
        adapters: new Map(),
        sessionManager: { getSession: () => undefined, patchRecord: () => {} },
        createSession: async () => ({ id: "test-session" }),
      },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() },
      pluginConfig: { maxAgentsPerGroup: 5, statusLogSize: 50, contextInjectionLimit: 10 },
      storage: {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        getDataDir: vi.fn().mockReturnValue("/tmp/cowork-test"),
      },
    };
    return new CoworkOrchestrator(mockCtx as any);
  }

  it("initializes with core reference", () => {
    const orch = makeOrchestrator();
    expect(orch).toBeDefined();
  });

  it("listGroups returns empty array initially", () => {
    const orch = makeOrchestrator();
    expect(orch.listGroups()).toHaveLength(0);
  });

  it("getGroup returns undefined for unknown id", () => {
    const orch = makeOrchestrator();
    expect(orch.getGroup("nonexistent")).toBeUndefined();
  });

  it("getGroupForSession returns undefined initially", () => {
    const orch = makeOrchestrator();
    expect(orch.getGroupForSession("session-1")).toBeUndefined();
  });

  it("destroy cleans up without error", () => {
    const orch = makeOrchestrator();
    expect(() => orch.destroy()).not.toThrow();
  });
});
