import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeClaudeState = {
  loggedIn?: boolean;
  email?: string;
  subscriptionType?: string;
  account?: { email?: string; subscriptionType?: string };
  login?: "success" | "fail" | "hang";
  turns?: unknown[][];
};

export type FakeClaudeCall = {
  kind: "spawn" | "control" | "user" | "permission" | "mcp";
  args?: string[];
  env?: Record<string, string>;
  subtype?: string;
  sdkMcpServers?: string[];
  content?: unknown;
  tool_name?: string;
  tool?: string;
  response?: unknown;
};

const SCRIPT = join(import.meta.dirname, "fake-claude.mjs");

/**
 * A temp folder driving fake-claude.mjs. `env` is the base environment to hand the
 * connector: it carries FAKE_CLAUDE_DIR, plus whatever the test adds.
 */
export function fakeClaude(state: FakeClaudeState, extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "motionbrief-fake-claude-"));
  writeFileSync(join(dir, "state.json"), JSON.stringify(state));

  return {
    path: SCRIPT,
    env: { ...process.env, ...extraEnv, FAKE_CLAUDE_DIR: dir },
    workspace: dir,
    calls(): FakeClaudeCall[] {
      const file = join(dir, "calls.jsonl");

      if (!existsSync(file)) {
        return [];
      }

      return readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as FakeClaudeCall);
    },
    spawns(command: string) {
      return this.calls()
        .filter((call) => call.kind === "spawn")
        .filter((call) => call.args?.join(" ").startsWith(command));
    },
    /** Retries while a closing agent process, whose working directory this is, exits (Windows locks it). */
    dispose() {
      return rm(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
    },
  };
}

export type FakeClaude = ReturnType<typeof fakeClaude>;

export type AnthropicRequest = {
  method?: string;
  path?: string;
  apiKey?: string;
  version?: string;
  body: unknown;
};

/** A local stand-in for api.anthropic.com that answers every request with `reply`. */
export async function fakeAnthropic(reply: (request: AnthropicRequest) => { status: number; body: unknown }) {
  const requests: AnthropicRequest[] = [];
  const server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const request = {
        method: req.method,
        path: req.url,
        apiKey: header(req, "x-api-key"),
        version: header(req, "anthropic-version"),
        body: JSON.parse(body || "null") as unknown,
      };
      requests.push(request);
      const { status, body: responseBody } = reply(request);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(responseBody));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function header(req: IncomingMessage, name: string) {
  const value = req.headers[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}
