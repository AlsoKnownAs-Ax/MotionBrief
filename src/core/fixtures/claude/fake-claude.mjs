#!/usr/bin/env node
/**
 * A stand-in for the bundled `claude` binary, so tests exercise the real Agent SDK and the
 * real subprocess handling without a login or tokens. It is driven by `state.json` in the
 * folder named by FAKE_CLAUDE_DIR and records every call to `calls.jsonl` there.
 *
 * state.json:
 *   loggedIn, email, subscriptionType   what `claude auth status` reports without an API key
 *   account                             overrides what a session's account info reports
 *   login: "success" | "fail" | "hang"  what `claude auth login` does
 *   turns: [[step, ...], ...]           what each user message gets back, in order. A step is an
 *                                       SDK message (session_id and uuid are filled in), or
 *                                       { "awaitInterrupt": true }, { "permission": { tool_name, input } },
 *                                       or { "mcp": { server, tool, arguments } }.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { setInterval } from "node:timers";

const dir = process.env.FAKE_CLAUDE_DIR;

if (!dir) {
  process.stderr.write("FAKE_CLAUDE_DIR is not set\n");
  process.exit(2);
}

const statePath = join(dir, "state.json");
// Steps can name files in the workspace (this folder) as {{workspace}}.
const state = JSON.parse(readFileSync(statePath, "utf8").replaceAll("{{workspace}}", JSON.stringify(dir).slice(1, -1)));
const args = process.argv.slice(2);
const RECORDED_ENV = ["ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "DISABLE_AUTOUPDATER", "CLAUDE_AGENT_SDK_CLIENT_APP"];

function record(entry) {
  appendFileSync(join(dir, "calls.jsonl"), `${JSON.stringify(entry)}\n`);
}

record({
  kind: "spawn",
  args,
  env: Object.fromEntries(RECORDED_ENV.filter((name) => name in process.env).map((name) => [name, process.env[name]])),
});

if (args[0] === "auth" && args[1] === "status") {
  authStatus();
} else if (args[0] === "auth" && args[1] === "login") {
  authLogin();
} else if (args.includes("stream-json")) {
  streamJson();
} else {
  process.stderr.write(`fake claude: unexpected arguments ${args.join(" ")}\n`);
  process.exit(2);
}

function authStatus() {
  if (process.env.ANTHROPIC_API_KEY) {
    print({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY" });
    process.exit(0);
  }

  if (!state.loggedIn) {
    print({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" });
    process.exit(1);
  }

  print({
    loggedIn: true,
    authMethod: "claude.ai",
    apiProvider: "firstParty",
    email: state.email,
    subscriptionType: state.subscriptionType,
  });
  process.exit(0);
}

function authLogin() {
  if (state.login === "hang") {
    setInterval(() => {}, 1_000);
    return;
  }

  if (state.login === "fail") {
    process.stderr.write("Login failed\n");
    process.exit(1);
  }

  writeFileSync(statePath, JSON.stringify({ ...state, loggedIn: true }));
  process.stdout.write("Login successful.\n");
  process.exit(0);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function streamJson() {
  const sessionId = argValue("--resume") ?? "fake-session-1";
  const turns = [...(state.turns ?? [])];
  const pending = new Map();
  let nextRequest = 0;
  let interrupted;
  let uuid = 0;

  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

  const request = (body) =>
    new Promise((resolve) => {
      const id = `fake-${(nextRequest += 1)}`;
      pending.set(id, resolve);
      send({ type: "control_request", request_id: id, request: body });
    });

  const respond = (requestId, response) =>
    send({ type: "control_response", response: { subtype: "success", request_id: requestId, response } });

  async function runTurn(steps) {
    for (const step of steps) {
      if (step.awaitInterrupt) {
        await new Promise((resolve) => (interrupted = resolve));
        continue;
      }

      if (step.permission) {
        const response = await request({ subtype: "can_use_tool", tool_use_id: `toolu_${uuid}`, ...step.permission });
        record({ kind: "permission", tool_name: step.permission.tool_name, response: response.response ?? response });
        continue;
      }

      if (step.mcp) {
        await callMcpTool(step.mcp);
        continue;
      }

      send({ session_id: sessionId, uuid: `00000000-0000-4000-8000-${String((uuid += 1)).padStart(12, "0")}`, ...step });
    }
  }

  async function callMcpTool({ server, tool, arguments: input }) {
    const mcp = (id, method, params) =>
      request({ subtype: "mcp_message", server_name: server, message: { jsonrpc: "2.0", id, method, params } });

    await mcp(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-claude", version: "0" } });
    const response = await mcp(2, "tools/call", { name: tool, arguments: input });
    record({ kind: "mcp", tool, response: response.response?.mcp_response ?? response.mcp_response });
  }

  const lines = createInterface({ input: process.stdin });

  lines.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    const message = JSON.parse(line);

    if (message.type === "control_response") {
      pending.get(message.response.request_id)?.(message.response);
      pending.delete(message.response.request_id);
      return;
    }

    if (message.type === "control_request") {
      handleControl(message);
      return;
    }

    if (message.type === "user") {
      record({ kind: "user", content: message.message.content });
      void runTurn(turns.shift() ?? []);
    }
  });

  lines.on("close", () => process.exit(0));

  function handleControl({ request_id: requestId, request: body }) {
    record({ kind: "control", subtype: body.subtype, sdkMcpServers: body.sdkMcpServers });

    if (body.subtype === "initialize") {
      respond(requestId, {
        commands: [],
        agents: [],
        output_style: "default",
        available_output_styles: [],
        models: [],
        account: account(),
      });
      return;
    }

    if (body.subtype === "interrupt") {
      respond(requestId, {});
      interrupted?.();
      return;
    }

    respond(requestId, {});
  }
}

function account() {
  if (process.env.ANTHROPIC_API_KEY) {
    return { apiKeySource: "ANTHROPIC_API_KEY", apiProvider: "firstParty" };
  }

  return {
    email: state.email,
    subscriptionType: state.subscriptionType,
    tokenSource: "claude.ai",
    apiProvider: "firstParty",
    ...state.account,
  };
}

/** `--name value` or `--name=value`. */
function argValue(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));

  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}
