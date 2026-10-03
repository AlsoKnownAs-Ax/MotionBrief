import { isAbsolute, relative, resolve, sep } from "node:path";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { SandboxPolicy } from "../connector";

/** The built-in tools a session gets: files only. Bash joins them when the policy allows shell. */
export const FILE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];

/** Each tool's input fields naming a path; a missing path means the working directory. */
const PATH_FIELDS: Record<string, string[]> = {
  Read: ["file_path"],
  Write: ["file_path"],
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  NotebookEdit: ["notebook_path"],
  Glob: ["path"],
  Grep: ["path"],
};

/**
 * Answers the agent's permission requests: files inside the workspace only, shell only when
 * the policy allows it, every MotionBrief host tool, nothing else.
 */
export function sandboxPermissions(workspaceDir: string, { allowShell }: SandboxPolicy, hostToolPrefix: string): CanUseTool {
  const workspace = resolve(workspaceDir);

  return async (toolName, input) => {
    if (toolName.startsWith(hostToolPrefix)) {
      return allow(input);
    }

    if (toolName === "Bash") {
      return decide(allowShell, input, "Shell commands are off for this run");
    }

    const fields = PATH_FIELDS[toolName];

    if (!fields) {
      return deny(`${toolName} isn't available here`);
    }

    const paths = fields.map((field) => input[field]).filter((path) => typeof path === "string");
    const isInside = paths.every((path) => isInsideDir(workspace, resolve(workspace, path)));

    return decide(isInside, input, "Only files in this video's workspace can be used");
  };
}

function isInsideDir(dir: string, path: string) {
  const fromDir = relative(dir, path);

  return fromDir !== ".." && !fromDir.startsWith(`..${sep}`) && !isAbsolute(fromDir);
}

function decide(isAllowed: boolean, input: Record<string, unknown>, reason: string): PermissionResult {
  if (!isAllowed) {
    return deny(reason);
  }

  return allow(input);
}

function allow(input: Record<string, unknown>): PermissionResult {
  return { behavior: "allow", updatedInput: input };
}

function deny(message: string): PermissionResult {
  return { behavior: "deny", message };
}
