import { describe, it, expect } from "vitest";
import { buildCoworkSystemPrompt } from "../cowork-prompt.js";

describe("buildCoworkSystemPrompt", () => {
  it("includes agent identity", () => {
    const prompt = buildCoworkSystemPrompt({
      agentName: "claude",
      role: "backend",
      groupName: "API Project",
      workspacePath: "/tmp/cowork-abc",
      otherMembers: [{ agentName: "cursor", role: "frontend" }],
    });

    expect(prompt).toContain("Agent: claude");
    expect(prompt).toContain("Role: backend");
    expect(prompt).toContain("Cowork group: API Project");
    expect(prompt).toContain("Workspace: /tmp/cowork-abc");
  });

  it("lists other members with roles", () => {
    const prompt = buildCoworkSystemPrompt({
      agentName: "claude",
      groupName: "Test",
      otherMembers: [
        { agentName: "cursor", role: "frontend" },
        { agentName: "copilot" },
      ],
    });

    expect(prompt).toContain("- cursor (frontend)");
    expect(prompt).toContain("- copilot");
  });

  it("includes STATUS format instructions", () => {
    const prompt = buildCoworkSystemPrompt({
      agentName: "claude",
      groupName: "Test",
      otherMembers: [],
    });

    expect(prompt).toContain("[STATUS]");
    expect(prompt).toContain("DONE:");
    expect(prompt).toContain("DECISIONS:");
    expect(prompt).toContain("NEXT:");
    expect(prompt).toContain("NEEDS:");
    expect(prompt).toContain("FILES:");
  });

  it("includes conflict awareness instructions", () => {
    const prompt = buildCoworkSystemPrompt({
      agentName: "claude",
      groupName: "Test",
      otherMembers: [],
    });

    expect(prompt).toContain("Conflict awareness");
    expect(prompt).toContain("DO NOT modify that file");
  });

  it("handles missing optional fields", () => {
    const prompt = buildCoworkSystemPrompt({
      agentName: "claude",
      groupName: "Test",
      otherMembers: [],
    });

    expect(prompt).not.toContain("Role:");
    expect(prompt).not.toContain("Workspace:");
    expect(prompt).toContain("(none yet)");
  });

  it("instructs to use [STATUS] blocks, not files", () => {
    const prompt = buildCoworkSystemPrompt({
      agentName: "claude",
      groupName: "Test",
      workspacePath: "/workspace/project",
      otherMembers: [],
    });

    expect(prompt).toContain("[STATUS]");
    expect(prompt).toContain("NOT in a file");
    expect(prompt).toContain("Do NOT write to status/");
  });
});
