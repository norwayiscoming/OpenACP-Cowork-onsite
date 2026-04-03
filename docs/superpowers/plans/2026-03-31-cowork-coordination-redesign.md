# Cowork Coordination Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix cowork plugin so agents notify each other on task completion without looping, and add a shared group thread for human overview.

**Architecture:** Hook into `turn:end` middleware to detect real task completions (via `[STATUS]` or auto-generated summary). Broadcast detailed status to group thread. Notify other agents with a flagged prompt so their responses don't re-trigger notifications. Group thread is created via `core.createSession` with a dummy session that acts as the shared topic.

**Tech Stack:** TypeScript, OpenACP Plugin SDK (PluginContext, middleware hooks, events)

**Constraint:** NO changes to OpenACP core. Only modify files in `OpenACP-Cowork-onsite/`.

---

### Task 1: Add `groupThreadId` to CoworkGroup and types

**Files:**
- Modify: `src/types.ts`
- Modify: `src/cowork-group.ts`

- [ ] **Step 1: Add `groupThreadId` to `CoworkGroupRecord`**

In `src/types.ts`, add the field:

```typescript
export interface CoworkGroupRecord {
  id: string;
  name: string;
  channelId: string;
  threadId: string;
  groupThreadId?: string;  // <-- add this
  workspacePath?: string;
  members: CoworkMemberRecord[];
  statusLog: StatusEntry[];
  createdAt: string;
}
```

- [ ] **Step 2: Add `groupThreadId` to `CoworkGroup` class**

In `src/cowork-group.ts`, add the field and update `toRecord()` and `fromRecord()`:

```typescript
export class CoworkGroup {
  readonly id: string;
  name: string;
  channelId: string;
  threadId: string;
  groupThreadId?: string;  // <-- add this
  workspacePath?: string;
  // ... rest unchanged
```

In `toRecord()` add:
```typescript
return {
  // ...existing fields
  groupThreadId: this.groupThreadId,
  // ...rest
};
```

In `fromRecord()` add:
```typescript
group.workspacePath = record.workspacePath;
group.groupThreadId = record.groupThreadId;  // <-- add this
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/cowork-group.ts
git commit -m "feat: add groupThreadId to CoworkGroup model"
```

---

### Task 2: Create group thread on group creation

**Files:**
- Modify: `src/cowork-orchestrator.ts`

The group thread is created via `core.createSession` with `createThread: true` — this makes OpenACP create a Telegram forum topic. We store the threadId from the session.

- [ ] **Step 1: Add `createGroupThread` helper to `CoworkCoreAccess` interface**

The existing `createSession` already returns a session with a threadId when `createThread: true`. We'll create a lightweight session that serves as the group thread.

In `src/cowork-orchestrator.ts`, update `createGroup()` — after creating the group object but before creating member sessions, create the group thread:

```typescript
async createGroup(params: {
  channelId: string;
  name: string;
  threadId: string;
  members: Array<{ agentName: string; role?: string; workingDirectory: string }>;
}): Promise<{ group: CoworkGroup; sessions: Array<{ id: string; enqueuePrompt(text: string): Promise<void> }> }> {
  const config = this.getConfig();
  if (params.members.length > config.maxAgentsPerGroup) {
    throw new Error(`Max ${config.maxAgentsPerGroup} agents per cowork group`);
  }

  const group = new CoworkGroup({
    name: params.name,
    channelId: params.channelId,
    threadId: params.threadId,
    maxStatusLogSize: config.statusLogSize,
  });

  const baseWorkspace = params.members[0]?.workingDirectory ?? ".";
  const groupWorkspace = path.join(baseWorkspace, `cowork-${group.id}`);
  await fs.mkdir(path.join(groupWorkspace, "status"), { recursive: true });
  group.workspacePath = groupWorkspace;

  // Create group thread (shared topic for human overview)
  const groupThreadSession = await this.core.createSession({
    channelId: params.channelId,
    agentName: params.members[0].agentName,
    workingDirectory: groupWorkspace,
    createThread: true,
    initialName: `🤝 ${params.name}`,
  });
  group.groupThreadId = groupThreadSession.id;

  const sessions: Array<{ id: string; enqueuePrompt(text: string): Promise<void> }> = [];

  for (const member of params.members) {
    const session = await this.core.createSession({
      channelId: params.channelId,
      agentName: member.agentName,
      workingDirectory: groupWorkspace,
      createThread: true,
      initialName: member.role ? `${member.agentName} — ${member.role}` : member.agentName,
    });

    group.addMember({
      sessionId: session.id,
      agentName: member.agentName,
      role: member.role,
    });

    this.core.sessionManager.patchRecord(session.id, { coworkGroupId: group.id });
    sessions.push(session);
  }

  const bridge = new CoworkBridge(group, this.makeBridgeDeps());
  this.bridges.set(group.id, bridge);

  await this.store.save(group);
  this.log.info(`Cowork group created: ${group.id} "${group.name}" with ${params.members.length} members`);

  return { group, sessions };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cowork-orchestrator.ts
git commit -m "feat: create group thread on cowork group creation"
```

---

### Task 3: Restore notification with loop prevention

**Files:**
- Modify: `src/cowork-bridge.ts`

Key design:
- `broadcastStatus` sends detailed status to **group thread** (using `groupThreadId`)
- `notifyOtherAgents` enqueues prompt to other agents so they know about the update
- `isNotificationResponse` flag prevents notification responses from triggering more notifications
- Only trigger on real task completions: explicit `[STATUS]` block or auto-generated status with actual content

- [ ] **Step 1: Add `enqueuePrompt` and `getSessionStatus` back to deps, add `isNotificationResponse` tracking**

```typescript
export interface CoworkBridgeDeps {
  log: Logger;
  contextInjectionLimit: number;
  sendMessage: (threadId: string, content: { type: "text"; text: string }) => Promise<void>;
  enqueuePrompt: (sessionId: string, text: string) => Promise<void>;
  getSessionStatus: (sessionId: string) => string | undefined;
}
```

Add field to class:

```typescript
export class CoworkBridge {
  private textBuffers: Map<string, string> = new Map();
  private explicitStatusPosted: Set<string> = new Set();
  private toolCallBuffers: Map<string, string[]> = new Map();
  private notificationResponses: Set<string> = new Set();  // <-- tracks sessions responding to notifications
  private memberSessionIds: Set<string>;
```

- [ ] **Step 2: Update `broadcastStatus` to send to group thread and notify agents**

```typescript
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

  // Broadcast to group thread (for human overview)
  if (this.group.groupThreadId) {
    const label = member.role
      ? `<b>${member.agentName} (${member.role})</b>`
      : `<b>${member.agentName}</b>`;

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
```

- [ ] **Step 3: Add `notifyOtherAgents` method with loop prevention**

```typescript
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

    // Mark this session as responding to a notification
    this.notificationResponses.add(otherSessionId);

    this.deps.enqueuePrompt(otherSessionId, notification).catch(err => {
      this.notificationResponses.delete(otherSessionId);
      this.deps.log.error(`Failed to notify agent ${otherSessionId}: ${err}`);
    });
  }
}
```

- [ ] **Step 4: Update `handlePromptComplete` to skip notification responses**

```typescript
private handlePromptComplete(sessionId: string): void {
  // If this turn was a notification response, don't broadcast or notify
  if (this.notificationResponses.has(sessionId)) {
    this.notificationResponses.delete(sessionId);
    this.textBuffers.set(sessionId, "");
    this.toolCallBuffers.delete(sessionId);
    this.explicitStatusPosted.delete(sessionId);
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
```

- [ ] **Step 5: Update `disconnect` to clear new field**

```typescript
disconnect(): void {
  this.textBuffers.clear();
  this.explicitStatusPosted.clear();
  this.toolCallBuffers.clear();
  this.notificationResponses.clear();
}
```

- [ ] **Step 6: Commit**

```bash
git add src/cowork-bridge.ts
git commit -m "feat: restore agent notifications with loop prevention via notificationResponses flag"
```

---

### Task 4: Update orchestrator deps to include enqueuePrompt and getSessionStatus

**Files:**
- Modify: `src/cowork-orchestrator.ts`

- [ ] **Step 1: Restore `enqueuePrompt` and `getSessionStatus` in `makeBridgeDeps()`**

```typescript
private makeBridgeDeps(): CoworkBridgeDeps {
  const config = this.getConfig();
  return {
    log: this.log,
    contextInjectionLimit: config.contextInjectionLimit,
    sendMessage: async (threadId, content) => {
      for (const adapter of this.core.adapters.values()) {
        try {
          await adapter.sendMessage(threadId, content);
          return;
        } catch { /* try next */ }
      }
    },
    enqueuePrompt: async (sessionId, text) => {
      const session = this.core.sessionManager.getSession(sessionId);
      if (session) await session.enqueuePrompt(text);
    },
    getSessionStatus: (sessionId) => {
      return this.core.sessionManager.getSession(sessionId)?.status;
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cowork-orchestrator.ts
git commit -m "feat: restore enqueuePrompt and getSessionStatus in bridge deps"
```

---

### Task 5: Update command to show group thread info

**Files:**
- Modify: `src/cowork-command.ts`

- [ ] **Step 1: Update `handleNew` confirmation message**

In the success reply, mention the group thread:

```typescript
const memberList = members.map(m => m.role ? `${m.agentName} (${m.role})` : m.agentName).join(", ");
await args.reply({
  type: "text",
  text: `🤝 Cowork group "${groupName}" created!\n\nAgents: ${memberList}\nGroup thread: ${group.name}\n\nAgents will notify each other on task completion. Status updates appear in the group thread.`,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/cowork-command.ts
git commit -m "feat: update cowork creation message with group thread info"
```

---

### Task 6: Build, test, publish

**Files:**
- Modify: `package.json` (version bump)
- Modify: `src/index.ts` (version bump)

- [ ] **Step 1: Bump version to 1.0.4**

In `package.json`: `"version": "1.0.4"`
In `src/index.ts`: `version: "1.0.4"`

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: Build success, no errors.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Fix any failures.

- [ ] **Step 4: Publish**

```bash
npm publish
```

- [ ] **Step 5: Commit and push**

```bash
git add package.json src/index.ts
git commit -m "chore: bump version to 1.0.4"
git push origin main
```

---

## Loop Prevention Summary

```
Sarah completes task
  → handlePromptComplete(sarah) → not in notificationResponses → broadcasts status
    → broadcastStatus → sends to group thread + notifyOtherAgents
      → enqueue prompt to Ryan, Jake, Brian
      → mark Ryan, Jake, Brian in notificationResponses

Ryan receives notification prompt
  → processes it, reports to human in his topic
  → turn ends → handlePromptComplete(ryan) → IS in notificationResponses → skip, no broadcast
  → ✅ No loop

Jake receives notification prompt
  → processes it, reports to human in his topic
  → turn ends → handlePromptComplete(jake) → IS in notificationResponses → skip, no broadcast
  → ✅ No loop
```
