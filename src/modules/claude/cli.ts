import { spawn } from "node:child_process";
import type { Result } from "../connector";
import type { BaseEnv } from "./environment";

export type CliOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CliError =
  | { code: "SPAWN_FAILED"; message: string }
  | { code: "ABORTED"; message: string };

/** Script paths the Agent SDK runs with Node rather than as a native binary; tests use one as a fake `claude`. */
const SCRIPT_EXTENSIONS = [".js", ".mjs", ".ts"];

/** Runs `claude <args>` to completion, or until `signal` aborts it. */
export function runClaude(claudePath: string, args: string[], env: BaseEnv, signal?: AbortSignal): Promise<Result<CliOutput, CliError>> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ data: null, error: { code: "ABORTED", message: "Cancelled before it started" } });
      return;
    }

    const { command, commandArgs } = commandFor(claudePath, args);
    const child = spawn(command, commandArgs, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const abort = () => child.kill();

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.once("error", (error) => {
      signal?.removeEventListener("abort", abort);
      resolve({ data: null, error: { code: "SPAWN_FAILED", message: error.message } });
    });
    child.once("close", (exitCode) => {
      signal?.removeEventListener("abort", abort);

      if (signal?.aborted) {
        resolve({ data: null, error: { code: "ABORTED", message: "Cancelled" } });
        return;
      }

      resolve({ data: { exitCode: exitCode ?? 1, stdout, stderr }, error: null });
    });
  });
}

function commandFor(claudePath: string, args: string[]) {
  if (SCRIPT_EXTENSIONS.some((extension) => claudePath.endsWith(extension))) {
    return { command: "node", commandArgs: [claudePath, ...args] };
  }

  return { command: claudePath, commandArgs: args };
}
