import { describe, it, expect, vi, beforeEach } from "vitest";
import { CoworkStore } from "../cowork-store.js";
import { CoworkGroup } from "../cowork-group.js";

function mockStorage() {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn(<T>(key: string): Promise<T | undefined> => Promise.resolve(data.get(key) as T | undefined)),
    set: vi.fn(async (key: string, value: unknown) => { data.set(key, value); }),
    delete: vi.fn(async (key: string) => { data.delete(key); }),
    list: vi.fn(async () => [...data.keys()]),
    getDataDir: vi.fn(() => "/tmp/test"),
  };
}

function mockLog() {
  return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() } as any;
}

describe("CoworkStore", () => {
  let storage: ReturnType<typeof mockStorage>;
  let store: CoworkStore;

  beforeEach(async () => {
    storage = mockStorage();
    store = new CoworkStore(storage as any, mockLog());
    await store.load();
  });

  it("saves and retrieves a group", async () => {
    const group = new CoworkGroup({ name: "test", channelId: "telegram", threadId: "t1" });
    await store.save(group);
    expect(store.get(group.id)).toBe(group);
    expect(storage.set).toHaveBeenCalled();
  });

  it("finds group by session id", async () => {
    const group = new CoworkGroup({ name: "test", channelId: "telegram", threadId: "t1" });
    group.addMember({ sessionId: "s1", agentName: "claude" });
    await store.save(group);
    expect(store.findBySessionId("s1")?.id).toBe(group.id);
    expect(store.findBySessionId("s999")).toBeUndefined();
  });

  it("finds group by thread", async () => {
    const group = new CoworkGroup({ name: "test", channelId: "telegram", threadId: "t1" });
    await store.save(group);
    expect(store.findByThread("telegram", "t1")?.id).toBe(group.id);
  });

  it("removes a group", async () => {
    const group = new CoworkGroup({ name: "test", channelId: "telegram", threadId: "t1" });
    await store.save(group);
    await store.remove(group.id);
    expect(store.get(group.id)).toBeUndefined();
  });

  it("loads from storage on init", async () => {
    const group = new CoworkGroup({ name: "persisted", channelId: "telegram", threadId: "t1" });
    const record = group.toRecord();
    storage = mockStorage();
    await storage.set("groups", { version: 1, groups: { [group.id]: record } });

    const store2 = new CoworkStore(storage as any, mockLog());
    await store2.load();
    expect(store2.get(group.id)?.name).toBe("persisted");
  });
});
