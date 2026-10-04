import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createClaudeConnector, memoryConnectionStore, type StoredConnection } from "../modules/claude";
import { defineHostTool, type AgentEvent, type Session, type SessionOptions } from "../modules/connector";
import { fakeClaude, type FakeClaude, type FakeClaudeState } from "./fixtures/claude/fake";
import * as sdk from "./fixtures/claude/messages";

const fakes: FakeClaude[] = [];
const sessions: Session[] = [];

afterEach(async () => {
  sessions.splice(0).forEach((session) => session.close());
  await Promise.all(fakes.splice(0).map((fake) => fake.dispose()));
});

const SUBSCRIBER: FakeClaudeState = { loggedIn: true, email: "you@example.com", subscriptionType: "max" };

function claude(state: FakeClaudeState, stored: StoredConnection = { method: "subscription" }, env: Record<string, string> = {}) {
  const fake = fakeClaude({ ...SUBSCRIBER, ...state }, env);
  fakes.push(fake);
  const connector = createClaudeConnector({ claudePath: fake.path, env: fake.env, store: memoryConnectionStore(stored) });

  return { connector, fake };
}

async function open(state: FakeClaudeState, options: Partial<SessionOptions> = {}, stored?: StoredConnection, env?: Record<string, string>) {
  const { connector, fake } = claude(state, stored, env);
  const { data: session, error } = await connector.startSession({ workspaceDir: fake.workspace, model: "claude-opus-5-5", ...options });

  if (error) {
    throw new Error(`startSession failed: ${error.code} ${error.message}`);
  }

  sessions.push(session);

  return { session, fake, connector };
}

async function collect(stream: AsyncIterable<AgentEvent>) {
  const events: AgentEvent[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
}

describe("a Claude session", () => {
  it("streams a turn as normalized events: text, tool calls, changed files, usage, completion", async () => {
    const { session, fake } = await open({
      turns: [
        [
          sdk.textDelta("Writing "),
          sdk.textDelta("the Scene."),
          sdk.toolUse("toolu_1", "Write", { file_path: "{{workspace}}/scenes/s1.html", content: "<div></div>" }),
          sdk.toolResult("toolu_1"),
          sdk.success({ result: "Done.", costUsd: 0.25, model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 300 }),
        ],
      ],
    });
    const scene = `${fake.workspace}/scenes/s1.html`;

    const events = await collect(session.sendTurn("Write Scene s1"));

    expect(events).toEqual([
      { type: "text-delta", text: "Writing " },
      { type: "text-delta", text: "the Scene." },
      { type: "tool-call", toolUseId: "toolu_1", name: "Write", input: { file_path: scene, content: "<div></div>" } },
      { type: "file-changed", path: scene },
      {
        type: "usage",
        costUsd: 0.25,
        usage: [{ model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.25 }],
      },
      { type: "turn-completed", status: "completed", text: "Done." },
    ]);
    expect(fake.calls().filter((call) => call.kind === "user")).toEqual([{ kind: "user", content: "Write Scene s1" }]);
    expect(session.id()).toBe("fake-session-1");
  });

  it("keeps one agent process across turns", async () => {
    const { session, fake } = await open({ turns: [[sdk.success({ result: "One" })], [sdk.success({ result: "Two" })]] });

    const first = await collect(session.sendTurn("First"));
    const second = await collect(session.sendTurn("Second"));

    expect(first.at(-1)).toMatchObject({ type: "turn-completed", text: "One" });
    expect(second.at(-1)).toMatchObject({ type: "turn-completed", text: "Two" });
    expect(fake.spawns("--output-format")).toHaveLength(1);
  });

  it("ends an interrupted turn with status interrupted", async () => {
    const { session } = await open({ turns: [[sdk.textDelta("Thinking"), { awaitInterrupt: true }, sdk.errorResult()]] });
    const events: AgentEvent[] = [];

    for await (const event of session.sendTurn("Go")) {
      events.push(event);

      if (event.type === "text-delta") {
        await session.interrupt();
      }
    }

    expect(events.at(-1)).toMatchObject({ type: "turn-completed", status: "interrupted" });
  });

  it("resumes an earlier session by id", async () => {
    const { session, fake } = await open({ turns: [[sdk.success({ result: "Back" })]] }, { resumeSessionId: "earlier-session" });

    await collect(session.sendTurn("Continue"));

    expect(fake.spawns("--output-format")[0]?.args).toContain("--resume=earlier-session");
    expect(session.id()).toBe("earlier-session");
  });
});

describe("errors", () => {
  it("maps a failed login mid-run to AUTHENTICATION_FAILED", async () => {
    const { session } = await open({ turns: [[sdk.apiError("authentication_failed"), sdk.errorResult()]] });

    const events = await collect(session.sendTurn("Go"));

    expect(events.at(-1)).toMatchObject({ type: "turn-completed", status: "failed", error: { code: "AUTHENTICATION_FAILED" } });
  });

  it("maps a plan limit to PLAN_LIMIT with its reset time, and reports the plan window", async () => {
    const resetsAt = 1_790_000_000;
    const { session } = await open({
      turns: [[sdk.rateLimit({ status: "rejected", rateLimitType: "five_hour", resetsAt, utilization: 1 }), sdk.apiError("rate_limit"), sdk.errorResult()]],
    });

    const events = await collect(session.sendTurn("Go"));

    expect(events).toContainEqual({
      type: "plan-usage",
      planUsage: { window: "five-hour", isRejected: true, resetsAt: resetsAt * 1_000, utilization: 1 },
    });
    expect(events.at(-1)).toMatchObject({
      type: "turn-completed",
      status: "failed",
      error: { code: "PLAN_LIMIT", resetsAt: resetsAt * 1_000 },
    });
  });

  it.each([
    ["billing_error", "BILLING"],
    ["model_not_found", "MODEL_UNAVAILABLE"],
    ["overloaded", "RATE_LIMITED"],
    ["server_error", "SERVICE_ERROR"],
  ])("maps %s to %s", async (sdkError, code) => {
    const { session } = await open({ turns: [[sdk.apiError(sdkError), sdk.errorResult()]] });

    const events = await collect(session.sendTurn("Go"));

    expect(events.at(-1)).toMatchObject({ type: "turn-completed", status: "failed", error: { code } });
  });

  it("reports a retry the agent makes on its own", async () => {
    const { session } = await open({ turns: [[sdk.apiRetry(2, 4_000), sdk.success({ result: "Done" })]] });

    const events = await collect(session.sendTurn("Go"));

    expect(events).toContainEqual({ type: "retrying", attempt: 2, delayMs: 4_000 });
  });
});

describe("connection checks before a run", () => {
  it("refuses to start a session on a broken login, without spending tokens", async () => {
    const { connector, fake } = claude({ loggedIn: false });

    const { error } = await connector.startSession({ workspaceDir: fake.workspace, model: "claude-opus-5-5" });

    expect(error?.code).toBe("AUTHENTICATION_FAILED");
    expect(fake.spawns("--output-format")).toHaveLength(0);
  });

  it("refuses to start before a method is chosen", async () => {
    const { connector, fake } = claude({}, {});

    const { error } = await connector.startSession({ workspaceDir: fake.workspace, model: "claude-opus-5-5" });

    expect(error?.code).toBe("AUTHENTICATION_FAILED");
  });

  it("passes the API key only to the agent process when it is the chosen method", async () => {
    const { session, fake } = await open(
      { loggedIn: false, turns: [[sdk.success({})]] },
      {},
      { method: "api-key", apiKey: "sk-ant-api03-agent-key" },
    );

    await collect(session.sendTurn("Go"));
    const [agent] = fake.spawns("--output-format");

    expect(agent?.env?.["ANTHROPIC_API_KEY"]).toBe("sk-ant-api03-agent-key");
    expect(agent?.env?.["DISABLE_AUTOUPDATER"]).toBe("1");
  });

  it("removes ANTHROPIC_API_KEY from a subscription run", async () => {
    const { session, fake } = await open({ turns: [[sdk.success({})]] }, {}, { method: "subscription" }, { ANTHROPIC_API_KEY: "sk-ant-from-the-shell" });

    await collect(session.sendTurn("Go"));
    const [agent] = fake.spawns("--output-format");

    expect(agent?.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(agent?.env).not.toHaveProperty("CLAUDE_CONFIG_DIR");
  });

  it("shows how many days the login has left once Claude warns it is expiring", async () => {
    const { session, connector } = await open({ turns: [[sdk.notification("oauth-expiry-warning", "Your login expires in 2 days"), sdk.success({})]] });

    const events = await collect(session.sendTurn("Go"));

    expect(events).toContainEqual({ type: "login-expiring", daysLeft: 2 });
    expect((await connector.status()).expiresInDays).toBe(2);
  });
});

describe("host tools and the sandbox", () => {
  it("mounts host tools over MCP and runs them when the agent calls them", async () => {
    const calls: unknown[] = [];
    const getTranscript = defineHostTool({
      name: "get_transcript",
      description: "The Transcript words of one Scene",
      input: { sceneId: z.string() },
      run: async ({ sceneId }) => {
        calls.push(sceneId);
        return { text: `words of ${sceneId}` };
      },
    });
    const { session, fake } = await open(
      { turns: [[{ mcp: { server: "motionbrief", tool: "get_transcript", arguments: { sceneId: "s2" } } }, sdk.success({})]] },
      { hostTools: [getTranscript] },
    );

    await collect(session.sendTurn("Go"));

    expect(calls).toEqual(["s2"]);
    expect(fake.calls().find((call) => call.kind === "mcp")?.response).toMatchObject({
      result: { content: [{ type: "text", text: "words of s2" }] },
    });
    expect(fake.calls().find((call) => call.subtype === "initialize")?.sdkMcpServers).toEqual(["motionbrief"]);
  });

  it("lets the agent write inside its workspace only, and never run shell commands by default", async () => {
    const { session, fake } = await open({
      turns: [
        [
          sdk.permission("Write", { file_path: "{{workspace}}/scenes/s1.html", content: "" }),
          sdk.permission("Write", { file_path: "{{workspace}}/../elsewhere.txt", content: "" }),
          sdk.permission("Bash", { command: "echo hi" }),
          sdk.success({}),
        ],
      ],
    });

    await collect(session.sendTurn("Go"));

    const decisions = fake.calls().filter((call) => call.kind === "permission").map((call) => [call.tool_name, behaviorOf(call.response)]);
    expect(decisions).toEqual([
      ["Write", "allow"],
      ["Write", "deny"],
      ["Bash", "deny"],
    ]);
  });
});

function behaviorOf(response: unknown) {
  return (response as { behavior?: string }).behavior;
}
