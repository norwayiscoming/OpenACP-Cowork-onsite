# OpenACP Cowork

Multi-agent coordination plugin for [OpenACP](https://github.com/Open-ACP/OpenACP).

OpenACP Cowork enables multiple AI agents to collaborate on shared tasks — with shared workspaces, status broadcasting, transparent context injection, and file conflict detection. Agents don't need to know about each other. The coordination layer handles everything.

## Installation

### Prerequisites

- [OpenACP](https://github.com/Open-ACP/OpenACP) v0.5.2+ installed and configured
- Node.js >= 20

### Install the plugin

```bash
openacp install @openacp/cowork
```

That's it. The plugin is automatically registered in your config and will load on next start.

### Install from Git (if not published to npm)

```bash
openacp install git+https://github.com/norwayiscoming/OpenACP-Cowork.git
```

### Install from local path (for development)

```bash
openacp install /path/to/openacp-cowork
```

### Verify installation

```bash
openacp plugins
```

You should see `@openacp/cowork` in the list.

### Start OpenACP

```bash
openacp start
```

Look for this line in the logs:

```
INFO: Core plugin loaded — plugin: "cowork", version: "0.1.0"
```

## Quick Start

### 1. Create a cowork group

In your Telegram group, send:

```
/cowork "My Project" claude:backend claude:frontend
```

This creates:
- A group status thread where all updates are posted
- A separate session thread for each agent
- A shared workspace directory at `cowork-{id}/`

### 2. Talk to each agent

Send tasks to each agent in their own thread:

```
[Thread: claude — backend]
You: Build the REST API with JWT auth

[Thread: claude — frontend]
You: Build the login form that calls the auth API
```

Each agent automatically receives context about what the other agents are doing.

### 3. Monitor progress

```
/cowork status
```

The group thread shows all status updates from every agent in real time.

### 4. End the group

```
/cowork end
```

Sessions continue independently — only the coordination stops.

## How It Works

OpenACP Cowork is a **core plugin** that hooks into OpenACP's plugin system. It imports OpenACP's core abstractions (sessions, adapters, config) and builds the coordination layer on top — without reimplementing any OpenACP logic.

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

### Status Broadcasting

After meaningful work, agents post structured status updates:

```
[STATUS]
DONE: Created /api/auth endpoint with JWT support
- POST /api/auth/login, POST /api/auth/logout
DECISIONS: Used RS256 signing
NEXT: Add refresh token rotation
NEEDS: Frontend agent to build login form
FILES: src/api/auth.ts
```

If an agent doesn't post an explicit `[STATUS]`, the bridge auto-generates one from the agent's output and tool calls.

### Context Injection

Before each prompt, the bridge prepends recent peer statuses to the agent's input — transparently:

```
[Cowork Context — Recent updates from other agents in your group]

[claude (backend) — 2m ago]
DONE: Created /api/auth endpoint with JWT support
DECISIONS: Used RS256 signing
FILES: src/api/auth.ts

[claude (frontend) — 5m ago]
Working on login form component

---

<your actual prompt>
```

Agents are always aware of what their peers have done, without any custom code.

### Conflict Detection

The bridge tracks which files each agent is working on. When two agents touch the same file, conflicts are flagged.

## Configuration

Cowork settings live inside the OpenACP config (`~/.openacp/config.json`):

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
| `statusLogSize` | 50 | In-memory status log buffer size |
| `contextInjectionLimit` | 10 | Max recent statuses injected per prompt |
| `conflictDetection` | true | Track files per agent to detect conflicts |

## Commands

| Command | Description |
|---------|-------------|
| `/cowork "Name" agent1:role1 agent2:role2` | Create a new cowork group |
| `/cowork status` | List active cowork groups |
| `/cowork end` | End the current group (in group thread) |
| `/cowork end <groupId>` | End a specific group by ID |

## Workspace Layout

```
{baseWorkspace}/
  cowork-{groupId}/
    status/
      {timestamp}_{agentName}_{statusId}.json
    <shared working files>
```

All agents in a group share the same workspace. The `status/` subdirectory contains JSON status files that any agent can read for full history.

## Uninstall

```bash
openacp install @openacp/cowork
```

The plugin is automatically removed from your config.

## Development

```bash
git clone https://github.com/norwayiscoming/OpenACP-Cowork.git
cd OpenACP-Cowork
npm install
npm run build
npm test
```

To test locally with OpenACP:

```bash
# Link the plugin
npm link
cd ~/.openacp/plugins
npm link @openacp/cowork

# Restart OpenACP
openacp stop && openacp start
```

## Design Principles

- **File-based coordination** — Agents coordinate through a shared workspace. Status updates are JSON files.
- **Transparent context injection** — Agents don't need special code to participate.
- **No push notifications** — Peers receive context only on their next prompt. No infinite loops.
- **Explicit status over implicit** — `[STATUS]` blocks for important updates. Auto-generated status as fallback.
- **Platform-agnostic core** — Coordination primitives are platform-independent. Telegram support comes from OpenACP's adapter layer.

## Current Limitations

- No automatic task planning or work distribution
- No dependency graph between agent tasks
- Single platform per group
- File-level conflict detection only

## License

MIT
