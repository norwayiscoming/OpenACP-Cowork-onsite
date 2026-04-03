# Cowork Coordination Redesign

## Problem

Current cowork plugin has two issues:
1. No group thread — agents only have individual topics, no shared overview for human
2. Notification loop — old `notifyOtherAgents` caused exponential loop with multiple agents; after removing it, agents have no way to know about each other's updates (they sit idle)

## Design

### Group Creation

When user runs `/cowork "Experiment Team" claude:Sarah claude:Ryan claude:Jake claude:Brian`:

1. Create **5 topics** on Telegram:
   - 1 **group thread** named "Experiment Team" — shared overview for human
   - 4 **agent topics** — one per agent (Sarah, Ryan, Jake, Brian)
2. Create shared workspace folder `experiment-team/` with `status/` subfolder
3. Inject cowork system prompt into each agent

### Task Completion Signal

OpenACP core already emits a "Task completed" notification when an agent finishes a task. The cowork plugin hooks into this signal.

When an agent completes a task:

1. **Collect status** — prioritize agent's explicit `[STATUS]` block; fallback to auto-generated summary from text/tool output
2. **Broadcast to group thread** — send detailed status to the shared group topic so human can track progress
3. **Notify other agents** — enqueue a prompt to each other agent in the group with the status content

### Agent Notification Response

When an agent receives a cowork notification:

1. Agent reads the signal, analyzes relevance to its own work
2. Agent reports back to human in its own topic (e.g., "Sarah just finished task X with Ryan. Do you want me to do anything about this?")
3. Human decides whether the agent should act

This response is **not** a task completion — it does not emit "Task completed" signal, therefore:
- No status broadcast to group thread
- No notification to other agents
- **No loop**

### Loop Prevention

The loop is prevented naturally by the signal itself:
- "Task completed" signal → triggers broadcast + notify → agents respond
- Agent notification response → no "Task completed" signal → nothing triggers
- Only real work completion (human-initiated tasks) produces "Task completed"

No flags, counters, or suppress mechanisms needed.

### Group Thread (Topic #5)

- Displays detailed status from all agents when they complete tasks
- Human uses it as a read-only overview dashboard
- Human can also chat in it (human's space)

### Status Content

When broadcasting to group thread, status should be detailed:

```
[Sarah — backend]
DONE: Implemented user authentication API endpoints
- POST /api/auth/login, POST /api/auth/register
- JWT token generation with 24h expiry
- Password hashing with bcrypt
DECISIONS: Used JWT over session cookies for stateless API
NEXT: Will add refresh token logic
FILES: src/auth/controller.ts, src/auth/middleware.ts
```

### Middleware (unchanged)

`agent:beforePrompt` middleware continues to inject recent cowork context from the status log. This provides passive awareness — agents see what others have done when they receive their next prompt.

## Changes Required

### cowork-orchestrator.ts
- `createGroup()` must create a group thread (topic) in addition to agent topics
- Store group thread ID in the group model

### cowork-group.ts
- Add `groupThreadId` field to store the shared topic ID

### cowork-bridge.ts
- Restore notification to other agents, but **only triggered by task completion signal**
- Broadcast status to group thread (using `groupThreadId`, not individual agent threads)
- Remove old `suppressNotification` mechanism (not needed)

### index.ts (plugin setup)
- Hook into the correct OpenACP event for "Task completed" signal
- Wire task completion → status collection → broadcast → notify flow

### cowork-command.ts
- Update `handleNew` to show group thread info in creation confirmation

### types.ts
- Add `groupThreadId` to `CoworkGroupRecord`
