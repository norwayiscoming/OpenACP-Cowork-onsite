import { buildCoworkSystemPrompt } from "./cowork-prompt.js";
import type { CoworkOrchestrator, CoworkCoreAccess } from "./cowork-orchestrator.js";
import type { CommandDef, CommandArgs, CommandResponse, PluginContext } from "@openacp/cli";

type Logger = PluginContext["log"];

function parseArgs(input: string): { name: string; memberSpecs: string[] } | null {
  let name: string;
  let rest: string;

  const quotedMatch = input.match(/^"([^"]+)"\s*(.*)/);
  if (quotedMatch) {
    name = quotedMatch[1];
    rest = quotedMatch[2];
  } else {
    const parts = input.split(/\s+/);
    name = parts[0];
    rest = parts.slice(1).join(" ");
  }

  if (!name) return null;
  return { name, memberSpecs: rest.split(/\s+/).filter(Boolean) };
}

function parseMemberSpec(spec: string): { agentName: string; role?: string } {
  const idx = spec.indexOf(":");
  if (idx === -1) return { agentName: spec };
  return { agentName: spec.slice(0, idx), role: spec.slice(idx + 1) || undefined };
}

export function createCoworkCommand(
  orchestrator: CoworkOrchestrator,
  core: CoworkCoreAccess,
  log: Logger,
): CommandDef {
  return {
    name: "cowork",
    description: "Manage multi-agent collaboration groups",
    usage: '"Group Name" agent1:role1 agent2:role2 | status | end [groupId]',
    category: "plugin",

    async handler(args: CommandArgs): Promise<CommandResponse | void> {
      const trimmed = args.raw.trim();

      if (trimmed === "status" || trimmed === "list") {
        await handleStatus(args, orchestrator);
        return;
      }

      if (trimmed.startsWith("end")) {
        await handleEnd(args, orchestrator, trimmed.replace(/^end\s*/, "").trim());
        return;
      }

      if (trimmed.length === 0) {
        await args.reply({
          type: "text",
          text: 'Usage:\n/cowork "Group Name" agent1:role1 agent2:role2\n/cowork status \u2014 list active groups\n/cowork end \u2014 end a cowork group',
        });
        return;
      }

      await handleNew(args, orchestrator, core, log, trimmed);
    },
  };
}

async function handleNew(
  args: CommandArgs,
  orchestrator: CoworkOrchestrator,
  core: CoworkCoreAccess,
  log: Logger,
  raw: string,
): Promise<void> {
  const parsed = parseArgs(raw);
  if (!parsed || parsed.memberSpecs.length === 0) {
    await args.reply({ type: "text", text: 'Usage: /cowork "Group Name" agent1:role1 agent2:role2' });
    return;
  }

  const { name: groupName, memberSpecs } = parsed;
  const members: Array<{ agentName: string; role?: string }> = [];

  for (const spec of memberSpecs) {
    const { agentName, role } = parseMemberSpec(spec);
    if (core.agentCatalog) {
      const agentDef = core.agentCatalog.resolve(agentName);
      if (!agentDef) {
        await args.reply({ type: "text", text: `Agent "${agentName}" not found.` });
        return;
      }
    }
    members.push({ agentName, role });
  }

  const workspace = (core.configManager as any).resolveWorkspace?.() ?? ".";

  try {
    const { group, sessions } = await orchestrator.createGroup({
      channelId: args.channelId,
      name: groupName,
      threadId: args.sessionId ?? "system",
      members: members.map(m => ({ ...m, workingDirectory: workspace })),
    });

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const member = members[i];
      const otherMembers = members.filter((_, idx) => idx !== i);

      const systemPrompt = buildCoworkSystemPrompt({
        agentName: member.agentName,
        role: member.role,
        groupName,
        workspacePath: group.workspacePath,
        otherMembers,
      });

      session.enqueuePrompt(systemPrompt).catch((err: Error) => {
        log.error(`Failed to inject cowork system prompt: ${err}`);
      });
    }

    const memberList = members.map(m => m.role ? `${m.agentName} (${m.role})` : m.agentName).join(", ");
    await args.reply({
      type: "text",
      text: `Cowork group "${groupName}" created with ${sessions.length} agent(s): ${memberList}`,
    });
  } catch (err) {
    await args.reply({ type: "text", text: `Failed to create cowork group: ${err}` });
  }
}

async function handleStatus(args: CommandArgs, orchestrator: CoworkOrchestrator): Promise<void> {
  const groups = orchestrator.listGroups();
  if (groups.length === 0) {
    await args.reply({ type: "text", text: "No active cowork groups." });
    return;
  }

  const lines = groups.map(group => {
    const memberList = Array.from(group.members.values())
      .map(m => `${m.agentName}${m.role ? ` (${m.role})` : ""}`)
      .join(", ");
    return `"${group.name}" \u2014 ${group.members.size} member(s): ${memberList} (ID: ${group.id})`;
  });

  await args.reply({ type: "text", text: `Active Cowork Groups:\n\n${lines.join("\n")}` });
}

async function handleEnd(
  args: CommandArgs,
  orchestrator: CoworkOrchestrator,
  groupIdArg: string,
): Promise<void> {
  const groups = orchestrator.listGroups();
  if (groups.length === 0) {
    await args.reply({ type: "text", text: "No active cowork groups to end." });
    return;
  }

  let groupId = groupIdArg;
  if (!groupId && groups.length === 1) {
    groupId = groups[0].id;
  }

  if (!groupId) {
    const lines = groups.map(g => `/cowork end ${g.id} \u2014 ${g.name}`);
    await args.reply({ type: "text", text: `Which group to end?\n\n${lines.join("\n")}` });
    return;
  }

  const group = groups.find(g => g.id === groupId);
  if (!group) {
    await args.reply({ type: "text", text: `Cowork group "${groupId}" not found.` });
    return;
  }

  try {
    await orchestrator.endGroup(groupId);
    await args.reply({ type: "text", text: `Cowork group "${group.name}" ended.` });
  } catch (err) {
    await args.reply({ type: "text", text: `Failed to end cowork group: ${err}` });
  }
}
