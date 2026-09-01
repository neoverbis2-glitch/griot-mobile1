/**
 * GRIOT Action & Command Parser
 * Extracts structured actions (fs, git, shell, test) from streaming or complete AI text.
 */

import { GriotAction, GriotActionType, RiskLevel } from "./protocol";

function stableActionId(rawBlock: string): string {
  let hash = 2166136261;
  for (let i = 0; i < rawBlock.length; i++) {
    hash ^= rawBlock.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `act_${(hash >>> 0).toString(36)}`;
}

function calculateRisk(type: GriotActionType, params: Record<string, unknown>): RiskLevel {
  if (
    type === "fs.read_tree" ||
    type === "fs.read_file" ||
    type === "git.status" ||
    type === "git.log"
  ) {
    return "safe";
  }

  if (type === "shell.exec") {
    const cmd = String(params.command || "")
      .trim()
      .toLowerCase();
    if (
      cmd.includes("rm -rf /") ||
      cmd.includes("mkfs") ||
      cmd.includes(":(){ :|:& };:") ||
      cmd.includes("dd if=") ||
      cmd.includes("chmod -r 777 /")
    ) {
      return "dangerous";
    }
    if (cmd.includes("git push --force") || cmd.includes("git reset --hard")) {
      return "dangerous";
    }
    return "sensitive";
  }

  if (type === "git.push") {
    if (
      Boolean(params.force) ||
      String(params.branch || "").includes("main") ||
      String(params.branch || "").includes("master")
    ) {
      return "sensitive";
    }
    return "sensitive";
  }

  if (type === "fs.delete_file") {
    return "sensitive";
  }

  if (
    type === "fs.write_file" ||
    type === "fs.patch" ||
    type === "shell.install" ||
    type === "test.run"
  ) {
    return "sensitive";
  }

  return "safe";
}

export function parseGriotActions(text: string): GriotAction[] {
  const actions: GriotAction[] = [];
  if (!text) return actions;

  // 1. Tag-based XML format: <griot_action type="shell.exec">...</griot_action>
  const tagRegex =
    /<griot_action\s+type=["']([^"']+)["'](?:\s+path=["']([^"']*)["'])?>([\s\S]*?)<\/griot_action>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    const typeStr = match[1].trim() as GriotActionType;
    const pathAttr = match[2]?.trim();
    const body = match[3]?.trim();

    let params: Record<string, unknown> = {};
    if (pathAttr) params.path = pathAttr;

    // Check if body is XML/JSON or plain text command
    if (body.startsWith("{") && body.endsWith("}")) {
      try {
        params = { ...params, ...(JSON.parse(body) as Record<string, unknown>) };
      } catch {
        params.content = body;
      }
    } else {
      // Subtag parsing (e.g., <command>npm install</command> or <content>...</content>)
      const cmdMatch = body.match(/<command>([\s\S]*?)<\/command>/i);
      const contentMatch = body.match(/<content>([\s\S]*?)<\/content>/i);
      const pathMatch = body.match(/<path>([\s\S]*?)<\/path>/i);
      const branchMatch = body.match(/<branch>([\s\S]*?)<\/branch>/i);
      const messageMatch = body.match(/<message>([\s\S]*?)<\/message>/i);

      if (cmdMatch) params.command = cmdMatch[1].trim();
      if (contentMatch) params.content = contentMatch[1];
      if (pathMatch) params.path = pathMatch[1].trim();
      if (branchMatch) params.branch = branchMatch[1].trim();
      if (messageMatch) params.message = messageMatch[1].trim();

      if (!cmdMatch && !contentMatch && !pathMatch && body) {
        if (typeStr.startsWith("shell.") || typeStr.startsWith("test.")) {
          params.command = body;
        } else if (typeStr.startsWith("fs.")) {
          params.content = body;
        }
      }
    }

    const category = (typeStr.split(".")[0] || "shell") as "fs" | "git" | "shell" | "test";
    const risk = calculateRisk(typeStr, params);

    actions.push({
      id: stableActionId(match[0]),
      type: typeStr,
      category,
      risk,
      params,
      rawBlock: match[0],
      requiresApproval: risk !== "safe",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  }

  // 2. Specialized codeblock tags: ```griot:shell npm install``` or ```griot:fs:write src/file.ts```
  const codeBlockRegex = /```griot:([a-z0-9_.-]+)(?::([^\n]+))?\n([\s\S]*?)```/gi;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const rawType = match[1].trim();
    const pathOrArg = match[2]?.trim();
    const content = match[3];

    let actionType: GriotActionType = "shell.exec";
    const params: Record<string, unknown> = {};

    if (rawType === "shell" || rawType === "exec") {
      actionType = "shell.exec";
      params.command = content.trim();
    } else if (rawType === "install") {
      actionType = "shell.install";
      params.package = pathOrArg || content.trim();
    } else if (rawType === "write" || rawType === "fs.write") {
      actionType = "fs.write_file";
      params.path = pathOrArg || "output.txt";
      params.content = content;
    } else if (rawType === "test") {
      actionType = "test.run";
      params.command = content.trim() || pathOrArg || "npm test";
    } else if (rawType === "git.commit") {
      actionType = "git.commit";
      params.message = content.trim() || pathOrArg || "Update";
    }

    const category = (actionType.split(".")[0] || "shell") as "fs" | "git" | "shell" | "test";
    const risk = calculateRisk(actionType, params);

    actions.push({
      id: stableActionId(match[0]),
      type: actionType,
      category,
      risk,
      params,
      rawBlock: match[0],
      requiresApproval: risk !== "safe",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  }

  return actions;
}

export function stripActionBlocks(text: string): string {
  if (!text) return "";
  return text
    .replace(/<griot_action[\s\S]*?<\/griot_action>/gi, "")
    .replace(/```griot:[\s\S]*?```/gi, "")
    .trim();
}
