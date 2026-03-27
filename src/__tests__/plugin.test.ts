import { describe, it, expect, vi } from "vitest";
import coworkPlugin from "../index.js";

function mockPluginContext(overrides?: Record<string, unknown>) {
  const listeners = new Map<string, Function[]>();
  const registeredServices = new Map<string, unknown>();
  const registeredCommands = new Map<string, unknown>();
  const registeredMiddleware: Array<{ hook: string; opts: unknown }> = [];

  return {
    pluginName: "@openacp/cowork",
    pluginConfig: { maxAgentsPerGroup: 5, statusLogSize: 50, contextInjectionLimit: 10 },
    core: {
      configManager: { get: () => ({}), resolveWorkspace: () => "/tmp/test-workspace" },
      sessionManager: { getSession: vi.fn(), patchRecord: vi.fn() },
      adapters: new Map(),
      createSession: vi.fn(),
      agentCatalog: { resolve: vi.fn().mockReturnValue({}) },
    },
    log: {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      trace: vi.fn(), fatal: vi.fn(), child: vi.fn(),
    },
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn(),
    emit: vi.fn(),
    registerService: vi.fn((name: string, impl: unknown) => { registeredServices.set(name, impl); }),
    getService: vi.fn(),
    registerMiddleware: vi.fn((hook: string, opts: unknown) => { registeredMiddleware.push({ hook, opts }); }),
    registerCommand: vi.fn((def: any) => { registeredCommands.set(def.name, def); }),
    sendMessage: vi.fn(),
    storage: {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      getDataDir: vi.fn().mockReturnValue("/tmp/cowork-test"),
    },
    // expose for assertions
    _registeredServices: registeredServices,
    _registeredCommands: registeredCommands,
    _registeredMiddleware: registeredMiddleware,
    _listeners: listeners,
    ...overrides,
  };
}

describe("Cowork Plugin", () => {
  it("has correct plugin metadata", () => {
    expect(coworkPlugin.name).toBe("@openacp/cowork");
    expect(coworkPlugin.version).toBe("1.0.0");
    expect(coworkPlugin.permissions).toContain("kernel:access");
    expect(coworkPlugin.permissions).toContain("commands:register");
    expect(coworkPlugin.settingsSchema).toBeDefined();
  });

  it("has all lifecycle hooks", () => {
    expect(typeof coworkPlugin.setup).toBe("function");
    expect(typeof coworkPlugin.teardown).toBe("function");
    expect(typeof coworkPlugin.install).toBe("function");
    expect(typeof coworkPlugin.configure).toBe("function");
    expect(typeof coworkPlugin.uninstall).toBe("function");
    expect(typeof coworkPlugin.migrate).toBe("function");
  });

  it("registers service, command, and middleware on setup", async () => {
    const ctx = mockPluginContext();
    await coworkPlugin.setup(ctx as any);

    expect(ctx._registeredServices.has("cowork")).toBe(true);
    expect(ctx._registeredCommands.has("cowork")).toBe(true);
    expect(ctx._registeredMiddleware.length).toBeGreaterThanOrEqual(2);

    const hooks = ctx._registeredMiddleware.map(m => m.hook);
    expect(hooks).toContain("agent:beforePrompt");
    expect(hooks).toContain("turn:end");
  });

  it("subscribes to agent:event and session:created", async () => {
    const ctx = mockPluginContext();
    await coworkPlugin.setup(ctx as any);

    expect(ctx.on).toHaveBeenCalledWith("agent:event", expect.any(Function));
    expect(ctx.on).toHaveBeenCalledWith("session:created", expect.any(Function));
  });

  it("teardown cleans up without error", async () => {
    const ctx = mockPluginContext();
    await coworkPlugin.setup(ctx as any);
    await expect(coworkPlugin.teardown!()).resolves.not.toThrow();
  });

  it("migrate passes through old settings", async () => {
    const old = { maxAgentsPerGroup: 3 };
    const result = await coworkPlugin.migrate!({} as any, old, "0.1.0");
    expect(result).toEqual(old);
  });
});
