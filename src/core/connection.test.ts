import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeConnector, memoryConnectionStore, type ConnectionStore } from "../modules/claude";
import { createCore } from "./composition-root";
import { fakeAnthropic, fakeClaude, type FakeClaude, type FakeClaudeState } from "./fixtures/claude/fake";
import { createReplayConnector } from "./fixtures/replay-connector";

const fakes: FakeClaude[] = [];
const servers: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(fakes.splice(0).map((fake) => fake.dispose()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const SUBSCRIBER: FakeClaudeState = { loggedIn: true, email: "you@example.com", subscriptionType: "max" };

type Setup = {
  store?: ConnectionStore;
  apiBaseUrl?: string;
  env?: Record<string, string>;
};

function connect(state: FakeClaudeState, { store = memoryConnectionStore(), apiBaseUrl, env }: Setup = {}) {
  const fake = fakeClaude(state, env);
  fakes.push(fake);
  const connector = createClaudeConnector({ claudePath: fake.path, env: fake.env, store, apiBaseUrl });
  const { router } = createCore({ appVersion: "1.2.3", adapters: { connector } });

  return { core: createRouterClient(router), fake, store };
}

describe("connecting Claude", () => {
  it("detects an existing subscription login and waits for the user to confirm it", async () => {
    const { core } = connect(SUBSCRIBER);

    const status = await core.connection.status();

    expect(status).toMatchObject({ isConnected: false, login: { email: "you@example.com", plan: "max" } });
    expect(status.method).toBeUndefined();
  });

  it("labels the login with the account Claude itself reports", async () => {
    // The real account info names the plan "Claude Team" where auth status says "team".
    const { core } = connect({ ...SUBSCRIBER, account: { email: "team@example.com", subscriptionType: "Claude Team" } });

    const status = await core.connection.status();

    expect(status.login).toEqual({ email: "team@example.com", plan: "team" });
  });

  it("reports no login when Claude isn't signed in", async () => {
    const { core } = connect({ loggedIn: false });

    const status = await core.connection.status();

    expect(status.isConnected).toBe(false);
    expect(status.login).toBeUndefined();
  });

  it("connects with the detected login once the user confirms it", async () => {
    const { core } = connect(SUBSCRIBER);

    const { status, error } = await core.connection.useLogin();

    expect(error).toBeUndefined();
    expect(status).toMatchObject({ isConnected: true, method: "subscription", login: { email: "you@example.com" } });
    expect(await core.connection.status()).toMatchObject({ isConnected: true, method: "subscription" });
  });

  it("can't use a login that isn't there", async () => {
    const { core } = connect({ loggedIn: false });

    const { status, error } = await core.connection.useLogin();

    expect(error?.code).toBe("NO_LOGIN");
    expect(status.isConnected).toBe(false);
  });

  it("signs in through the bundled claude auth login, then uses that login", async () => {
    const { core, fake } = connect({ loggedIn: false, email: "new@example.com", subscriptionType: "pro", login: "success" });

    const { status, error } = await core.connection.signIn();

    expect(error).toBeUndefined();
    expect(status).toMatchObject({ isConnected: true, method: "subscription", login: { email: "new@example.com", plan: "pro" } });
    expect(fake.spawns("auth login")).toHaveLength(1);
  });

  it("stays disconnected when sign-in fails", async () => {
    const { core } = connect({ loggedIn: false, login: "fail" });

    const { status, error } = await core.connection.signIn();

    expect(error?.code).toBe("SIGN_IN_FAILED");
    expect(status.isConnected).toBe(false);
  });

  it("stops the sign-in when the call is cancelled", async () => {
    const { core } = connect({ loggedIn: false, login: "hang" });
    const abort = new AbortController();

    const pending = core.connection.signIn(undefined, { signal: abort.signal });
    setTimeout(() => abort.abort(), 300);
    const { status, error } = await pending;

    expect(error?.code).toBe("SIGN_IN_CANCELLED");
    expect(status.isConnected).toBe(false);
  });

  it("checks Claude again on request, picking up a login made in a terminal", async () => {
    const { core, fake } = connect({ loggedIn: false, email: "you@example.com", subscriptionType: "max" });
    expect((await core.connection.status()).login).toBeUndefined();

    signInFromTerminal(fake);

    expect((await core.connection.status()).login).toEqual({ email: "you@example.com", plan: "max" });
  });
});

describe("connecting with an API key", () => {
  const GOOD_KEY = "sk-ant-api03-good-key-1234";

  async function anthropicAccepting(...keys: string[]) {
    const api = await fakeAnthropic(({ apiKey }) => {
      if (apiKey && keys.includes(apiKey)) {
        return { status: 200, body: { input_tokens: 1 } };
      }

      return { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } };
    });
    servers.push(api);

    return api;
  }

  it("checks the key with the free count_tokens endpoint, stores it and connects with it", async () => {
    const api = await anthropicAccepting(GOOD_KEY);
    const { core, store } = connect({ loggedIn: false }, { apiBaseUrl: api.baseUrl });

    const { status, error } = await core.connection.setApiKey({ apiKey: GOOD_KEY });

    expect(error).toBeUndefined();
    expect(status).toMatchObject({ isConnected: true, method: "api-key", maskedKey: "sk-ant-…1234" });
    expect(api.requests).toEqual([
      expect.objectContaining({ method: "POST", path: "/v1/messages/count_tokens", apiKey: GOOD_KEY, version: "2023-06-01" }),
    ]);
    expect((await store.load()).data).toEqual({ method: "api-key", apiKey: GOOD_KEY });
  });

  it("never sends the key back, only a masked form", async () => {
    const api = await anthropicAccepting(GOOD_KEY);
    const { core } = connect(SUBSCRIBER, { apiBaseUrl: api.baseUrl });

    const result = await core.connection.setApiKey({ apiKey: GOOD_KEY });
    const status = await core.connection.status();

    expect(JSON.stringify([result, status])).not.toContain(GOOD_KEY);
  });

  it("trims a pasted key", async () => {
    const api = await anthropicAccepting(GOOD_KEY);
    const { core } = connect({ loggedIn: false }, { apiBaseUrl: api.baseUrl });

    const { status } = await core.connection.setApiKey({ apiKey: `  ${GOOD_KEY}\n` });

    expect(status.isConnected).toBe(true);
  });

  it("rejects a key Anthropic refuses and stores nothing", async () => {
    const api = await anthropicAccepting(GOOD_KEY);
    const { core, store } = connect({ loggedIn: false }, { apiBaseUrl: api.baseUrl });

    const { status, error } = await core.connection.setApiKey({ apiKey: "sk-ant-typo" });

    expect(error?.code).toBe("KEY_REJECTED");
    expect(status).toMatchObject({ isConnected: false });
    expect((await store.load()).data).toEqual({});
  });

  it("says so when Anthropic can't be reached to check the key", async () => {
    const api = await anthropicAccepting();
    await api.close();
    const { core } = connect({ loggedIn: false }, { apiBaseUrl: api.baseUrl });

    const { error } = await core.connection.setApiKey({ apiKey: GOOD_KEY });

    expect(error?.code).toBe("KEY_CHECK_FAILED");
  });

  it("removes the key, which disconnects until another method is chosen", async () => {
    const { core, store } = connect({ loggedIn: false }, { store: memoryConnectionStore({ method: "api-key", apiKey: GOOD_KEY }) });
    expect((await core.connection.status()).isConnected).toBe(true);

    const { status } = await core.connection.removeApiKey();

    expect(status).toMatchObject({ isConnected: false });
    expect(status.method).toBeUndefined();
    expect(status.maskedKey).toBeUndefined();
    expect((await store.load()).data).toEqual({});
  });

  it("keeps the subscription chosen when a stored key is removed", async () => {
    const { core } = connect(SUBSCRIBER, { store: memoryConnectionStore({ method: "subscription", apiKey: GOOD_KEY }) });

    const { status } = await core.connection.removeApiKey();

    expect(status).toMatchObject({ isConnected: true, method: "subscription" });
    expect(status.maskedKey).toBeUndefined();
  });

  it("gives the key to Claude only when the key is the chosen method", async () => {
    const { core, fake } = connect({ loggedIn: false }, { store: memoryConnectionStore({ method: "api-key", apiKey: GOOD_KEY }) });

    await core.connection.status();

    expect(fake.spawns("auth status").map((call) => call.env?.["ANTHROPIC_API_KEY"])).toEqual([GOOD_KEY]);
  });
});

describe("swapping the connector", () => {
  it("serves the connection of whichever connector the composition root is given", async () => {
    const { connector } = createReplayConnector([]);
    const { router } = createCore({ appVersion: "1.2.3", adapters: { connector } });

    const status = await createRouterClient(router).connection.status();

    expect(status).toEqual({ isConnected: true, method: "api-key" });
  });

  it("replays recorded turns and records what it was asked", async () => {
    const { connector, asked } = createReplayConnector([[{ type: "turn-completed", status: "completed", text: "Storyboard" }]]);
    const { data: session } = await connector.startSession({ workspaceDir: "/videos/horizontal", model: "claude-opus-5-5" });
    const events = [];

    for await (const event of session?.sendTurn("Plan the Storyboard") ?? []) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "turn-completed", status: "completed", text: "Storyboard" }]);
    expect(asked.map(({ message }) => message)).toEqual(["Plan the Storyboard"]);
  });
});

describe("the agent environment", () => {
  it("checks a subscription login without ANTHROPIC_API_KEY, without the auto-updater and without CLAUDE_CONFIG_DIR", async () => {
    const { core, fake } = connect(SUBSCRIBER, { env: { ANTHROPIC_API_KEY: "sk-ant-from-the-shell" } });

    await core.connection.useLogin();
    await core.connection.status();

    const checks = fake.spawns("auth status");
    expect(checks.length).toBeGreaterThan(0);
    checks.forEach((check) => {
      expect(check.env).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(check.env).not.toHaveProperty("CLAUDE_CONFIG_DIR");
      expect(check.env).toHaveProperty("DISABLE_AUTOUPDATER", "1");
    });
  });

  it("signs in without ANTHROPIC_API_KEY, so Claude stores its own subscription login", async () => {
    const { core, fake } = connect({ loggedIn: false, login: "success" }, { env: { ANTHROPIC_API_KEY: "sk-ant-from-the-shell" } });

    await core.connection.signIn();

    const [login] = fake.spawns("auth login");
    expect(login?.args).toEqual(["auth", "login", "--claudeai"]);
    expect(login?.env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });
});

function signInFromTerminal(fake: FakeClaude) {
  const statePath = join(fake.workspace, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as FakeClaudeState;
  writeFileSync(statePath, JSON.stringify({ ...state, loggedIn: true }));
}
