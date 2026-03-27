# OpenACP Cowork — Technical Specification

## 1. Overview

OpenACP Cowork is a coordination layer built on top of [OpenACP](https://github.com/Open-ACP/OpenACP) that enables multiple AI agents to collaborate on shared tasks. It provides the primitives for agent-to-agent awareness: shared workspaces, status broadcasting, context injection, and conflict detection.

OpenACP Cowork is **not** a standalone server. It is a library that extends OpenACP with multi-agent coordination capabilities. It imports OpenACP's core abstractions (sessions, adapters, agent instances) and builds the cowork layer on top.

## 2. Problem Statement

When multiple AI agents work on related tasks, they face three fundamental coordination problems:

1. **Awareness** — Agents don't know what other agents are doing, leading to duplicated or conflicting work.
2. **Context** — Each agent operates in isolation. One agent's output cannot inform another agent's decisions.
3. **Sequencing** — Tasks often have dependencies. Agent B needs Agent A's output before it can start.

OpenACP Cowork solves these by introducing a shared coordination plane between agents, without requiring agents to be aware of the underlying protocol.

## 3. Design Principles

- **File-based coordination** — Agents coordinate through a shared workspace folder. Status updates are written as JSON files. This is the same approach used by Claude Code's multi-agent system and is the simplest reliable coordination mechanism.
- **Transparent context injection** — Cowork context is prepended to each prompt automatically. Agents don't need special code to participate — they just read the context and write status updates.
- **No push notifications between agents** — Agents receive context from peers only when they process their next prompt. This avoids infinite notification loops and wasted API tokens.
- **Explicit status over implicit** — Agents post `[STATUS]` blocks when they complete meaningful work. Auto-generated status from prompt completion serves as a fallback.
- **Platform-agnostic core** — The coordination primitives (groups, status, context injection) are independent of any messaging platform. Telegram integration is provided by OpenACP's adapter layer.

## 4. Architecture

```
┌──────────────────────────────────────────────────────┐
│                   OpenACP Cowork                      │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  Cowork  │  │  Cowork  │  │   Cowork Bridge   │  │
│  │  Group   │  │  Store   │  │  (event wiring +  │  │
│  │          │  │          │  │  context injection)│  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
│  ┌──────────────────┐  ┌─────────────────────────┐  │
│  │  Cowork Prompt   │  │  Cowork Orchestrator    │  │
│  │  (system prompt  │  │  (group lifecycle,      │  │
│  │   builder)       │  │   member management)    │  │
│  └──────────────────┘  └─────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│                    OpenACP Core                       │
│  Session · AgentInstance · ChannelAdapter · Config    │
└──────────────────────────────────────────────────────┘
```

### 4.1 Dependency on OpenACP

OpenACP Cowork imports the following from `@openacp/cli`:

| Import | Purpose |
|--------|---------|
| `Session` | Attach cowork bridge, inject context before prompts |
| `SessionManager` | Look up sessions by ID for cross-agent wiring |
| `ChannelAdapter` | Send status messages to platform threads |
| `AgentEvent` | Listen to agent text/tool output |
| `ConfigManager` | Read cowork configuration |

OpenACP Cowork does **not** reimplement sessions, agent spawning, prompt queues, permission gates, or platform adapters. These are provided by OpenACP.

## 5. Core Components

### 5.1 CoworkGroup

In-memory representation of a collaboration group.

```typescript
interface CoworkMember {
  sessionId: string;
  agentName: string;
  role?: string;
  joinedAt: Date;
  currentFiles: Set<string>;  // Files this agent is working on
}

class CoworkGroup {
  id: string;                          // nanoid(12)
  name: string;                        // Display name
  channelId: string;                   // Platform identifier
  threadId: string;                    // Platform thread for group status
  workspacePath?: string;              // Shared workspace directory
  members: Map<string, CoworkMember>;  // sessionId → member
  statusLog: StatusEntry[];            // Circular buffer (configurable size)
  createdAt: Date;

  addMember(opts): void;
  removeMember(sessionId): void;
  appendStatus(entry: StatusEntry): void;
  getRecentStatuses(excludeSessionId, limit): StatusEntry[];
  toRecord(): CoworkGroupRecord;
  static fromRecord(record): CoworkGroup;
}
```

### 5.2 StatusEntry

A single status update from an agent.

```typescript
type CoworkStatusType = 'progress' | 'decision' | 'blocker' | 'request' | 'completed';

interface StatusEntry {
  id: string;              // nanoid(8)
  sessionId: string;
  agentName: string;
  role?: string;
  timestamp: string;       // ISO 8601
  content: string;         // Status message body
  type: CoworkStatusType;  // Auto-classified from content
  files?: string[];        // Extracted from "FILES:" line
}
```

**Status Classification Rules:**

| Content contains | Classified as |
|------------------|---------------|
| "blocker", "blocked" | `blocker` |
| "decision", "chose" | `decision` |
| "need", "request" | `request` |
| "completed", "done" | `completed` |
| (default) | `progress` |

### 5.3 CoworkStore

Persistent storage for cowork groups.

```typescript
class CoworkStore {
  constructor(filePath: string);  // e.g., ~/.openacp/cowork-groups.json

  async save(group: CoworkGroup): void;     // Debounced (2s)
  get(groupId: string): CoworkGroup | undefined;
  findBySessionId(sessionId: string): CoworkGroup | undefined;
  list(): CoworkGroup[];
  async remove(groupId: string): void;
}
```

**Storage Format:**
```json
{
  "version": 1,
  "groups": {
    "<groupId>": {
      "id": "...",
      "name": "...",
      "channelId": "...",
      "threadId": "...",
      "workspacePath": "...",
      "members": [...],
      "statusLog": [...],
      "createdAt": "..."
    }
  }
}
```

### 5.4 CoworkBridge

The central coordination engine. Wires agent events to the status broadcasting and context injection systems.

```typescript
interface CoworkBridgeOptions {
  contextInjectionLimit: number;  // Max recent statuses to inject (default: 10)
}

class CoworkBridge {
  constructor(
    group: CoworkGroup,
    sessionManager: SessionManager,
    adapter: ChannelAdapter,
    options: CoworkBridgeOptions,
  );

  connect(): void;                           // Wire all member sessions
  disconnect(): void;                        // Unwire all listeners
  wireSession(sessionId: string): void;      // Wire a single session (for late joins)
  buildCoworkContext(sessionId: string): string;  // Build context for injection
}
```

**Event Pipeline:**

```
Agent output (text/tool_call)
  │
  ▼
handleTextEvent / handleToolCallEvent
  │  Accumulates text in buffer, tracks tool calls
  │
  ▼
Explicit [STATUS] detected?
  ├─ YES → broadcastStatus() immediately, mark explicitStatusPosted
  └─ NO  → continue accumulating
  │
  ▼
prompt_complete event fires
  │
  ▼
Was explicit [STATUS] posted?
  ├─ YES → skip auto-broadcast, reset buffers
  └─ NO  → build auto-status from text + tools
           │
           ▼
         broadcastStatus()
           ├─ Append to group.statusLog (in-memory)
           ├─ Write JSON file to {workspace}/status/
           └─ Send formatted message to group thread
```

### 5.5 Context Injection

Before each prompt, the session calls `bridge.buildCoworkContext(sessionId)` to get recent status updates from other agents. This context is prepended to the user's prompt.

**Format:**
```
[Cowork Context — Recent updates from other agents in your group]

[claude (backend) — 2m ago]
DONE: Created /api/auth endpoint with JWT support
- POST /api/auth/login, POST /api/auth/logout
DECISIONS: Used RS256 signing
FILES: src/api/auth.ts

[cursor (frontend) — 5m ago]
Working on login form component

Status folder: /workspace/cowork-abc123/status
Follow decisions made by other agents. Flag conflicts if you see any.

---

<user's actual prompt>
```

### 5.6 Cowork System Prompt

Injected once when a session joins a cowork group. Instructs the agent on:

- Its identity within the group (name, role, other members)
- Shared workspace constraints (work only within the group folder)
- Required `[STATUS]` format after meaningful work
- How to handle updates from other agents
- Conflict awareness (don't modify files another agent is working on)

**STATUS Format:**
```
[STATUS]
DONE: {What was completed}
- {Technical details}
DECISIONS: {Decisions made and rationale}
NEXT: {What's planned next}
NEEDS: {Dependencies on other agents}
FILES: {Files created/modified}
```

## 6. Workspace Layout

Each cowork group gets an isolated workspace:

```
{baseWorkspace}/
  cowork-{groupId}/
    status/
      {timestamp}_{agentName}_{statusId}.json    # Status files
      ...
    <agent working files>                        # Shared between all agents
```

Agents are instructed to work only within their group's workspace directory. The `status/` subdirectory contains JSON files that any agent can read for full history.

## 7. Group Lifecycle

### 7.1 Creation

```
User: /cowork "Project Name" agent1:role1 agent2:role2
  │
  ▼
1. Validate agents exist in catalog
2. Create platform thread for group status
3. Create CoworkGroup instance
4. Create isolated workspace: cowork-{groupId}/status/
5. For each member:
   a. Spawn agent session (via OpenACP createSession)
   b. Create session thread on platform
   c. Register in group.members
   d. Link session record: coworkGroupId = groupId
6. Create and connect CoworkBridge
7. Inject cowork system prompt to each session
8. Persist group to CoworkStore
```

### 7.2 Active Operation

```
Agent receives prompt
  │
  ▼
Session.processPrompt()
  ├─ buildCoworkContext() → prepend peer statuses
  ├─ Send enriched prompt to agent
  ├─ Agent works, outputs text/tools
  ├─ CoworkBridge captures events
  ├─ On [STATUS] or prompt_complete → broadcastStatus()
  └─ Status visible to all peers on next prompt
```

### 7.3 Restart Recovery

```
Daemon restarts
  │
  ▼
User sends message to any member's topic
  │
  ▼
Lazy resume triggers for that session
  ├─ Session record has coworkGroupId
  ├─ restoreCoworkBridge() called
  ├─ CoworkBridge recreated from persisted group data
  └─ All other group members proactively resumed
      (so they can receive context on next prompt)
```

### 7.4 Termination

```
User: /cowork end [groupId]
  │
  ▼
1. Disconnect CoworkBridge (unwire all listeners)
2. Clear session.coworkBridge for all members
3. Remove group from CoworkStore
4. Sessions continue independently (no longer coordinated)
```

## 8. Configuration

```json
{
  "cowork": {
    "maxAgentsPerGroup": 5,
    "statusLogSize": 50,
    "contextInjectionLimit": 10,
    "conflictDetection": true
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `maxAgentsPerGroup` | 5 | Maximum members in a single group |
| `statusLogSize` | 50 | In-memory status log circular buffer size |
| `contextInjectionLimit` | 10 | Max recent statuses injected per prompt |
| `conflictDetection` | true | Track files per agent to detect conflicts |

## 9. API Surface

### Exported Types

```typescript
// Group management
export { CoworkGroup, type CoworkMember } from './cowork-group';
export { CoworkStore } from './cowork-store';

// Bridge (coordination engine)
export { CoworkBridge, type CoworkBridgeOptions } from './cowork-bridge';

// Prompt generation
export { buildCoworkSystemPrompt, type CoworkPromptParams } from './cowork-prompt';

// Status types
export type { StatusEntry, CoworkStatusType, CoworkGroupRecord, CoworkMemberRecord };
```

### Integration Points

For OpenACP adapters that want to support cowork:

```typescript
// 1. Register the /cowork command handler
adapter.registerCommand('cowork', handleCowork);

// 2. Implement sendToThread() for status broadcasting
class MyAdapter extends ChannelAdapter {
  async sendToThread(threadId: string, content: OutgoingMessage): Promise<void> {
    // Send directly to a thread, bypassing session lookup
  }
}
```

## 10. Limitations and Future Work

### Current Limitations

- **No task planning** — Users must manually assign tasks to each agent. There is no shared task queue or automatic work distribution.
- **No dependency graph** — Agent B cannot declare "wait for Agent A to finish X before starting Y."
- **Single platform per group** — All members must be on the same channel adapter.
- **No partial file locking** — Conflict detection tracks files per agent but cannot prevent concurrent edits at the code level.

### Potential Improvements

- **Goal-driven groups** — Accept a high-level goal at group creation, auto-distribute sub-tasks to agents based on roles.
- **Dependency-aware sequencing** — Allow agents to declare task dependencies; auto-trigger downstream agents when upstream completes.
- **Cross-platform groups** — Allow agents on different adapters (e.g., Telegram + Discord) to cowork.
- **Smarter context injection** — Use embeddings to inject only relevant peer statuses instead of most-recent-N.
- **Structured handoffs** — Formal protocol for one agent to hand off work products to another.
