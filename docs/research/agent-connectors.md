# Research: Agent connectors

Ticket: [#3](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/3) · Map: [#1](https://github.com/AlsoKnownAs-Ax/MotionBrief/issues/1) · Researched 2026-09-29

**Question.** Which agent connector should MotionBrief v1 ship, and what must the connector interface expose so more connectors can be added later?

**Answer (short).** Ship a **Claude connector built on the Claude Agent SDK**, the library that runs the Claude Code binary. It is the Claude Code connector the owner asked for. Its auth has two tiers:

1. **Anthropic API key (BYOK)** is the documented, explicitly allowed default.
2. **The user's existing Claude Code login (Pro/Max subscription)** also works if MotionBrief runs the *unmodified* Claude Code binary and never offers, collects, or handles a Claude login itself. Anthropic's current Help Center says this usage draws from subscription limits. However, Anthropic's developer docs also say third-party developers may not "offer claude.ai login or rate limits" without approval. Ship it as a clearly caveated option, and ask Anthropic for written approval before promoting it.

OpenAI's **Sign in with ChatGPT → ChatGPT plan usage for open-source apps** is the only subscription path either vendor documents *explicitly for third-party open-source apps*. That makes a Codex connector the best second connector.

Throughout, "the agent" means the model plus agent loop that generates and revises a video. Domain terms follow `CONTEXT.md`: Voiceover, Transcript, Style Preset, Format, Revision.

---

## 1. What MotionBrief needs from an agent

MotionBrief's agent must: read the Transcript (word timings), the Style Preset and the Format; **write project files** (the video composition); run **iterative Revisions** in the same conversation (resume across app restarts); **stream** progress to the chat UI; and let the app **constrain** what the agent can touch, keeping it inside the project folder. All four options below are judged against those needs.

---

## 2. Option A: Claude Code / Claude Agent SDK using the user's Claude subscription

### Feasibility: technically yes

- The Agent SDK "gives you the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript". It is "a library that runs the Claude Code binary". Source: [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview).
- Other languages can drive the same loop by running the CLI as a subprocess (`claude -p --output-format json|stream-json`). Source: [overview](https://code.claude.com/docs/en/agent-sdk/overview), [Run Claude Code programmatically](https://code.claude.com/docs/en/headless).
- Claude Code's credential precedence ends with "Subscription OAuth credentials from `/login`. This is the default for Claude Pro, Max, Team, and Enterprise users." An API key, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, or `CLAUDE_CODE_OAUTH_TOKEN` takes priority over it. These variables "apply to the CLI and the surfaces that wrap it, including … the Agent SDK". Source: [Authentication → precedence](https://code.claude.com/docs/en/authentication#authentication-precedence).
- Where credentials live: macOS Keychain; Windows `%USERPROFILE%\.claude\.credentials.json`. Source: [Authentication → Credential management](https://code.claude.com/docs/en/authentication#credential-management).
- `--bare` mode "never reads OAuth credentials or the system keychain", so the subscription path must **not** use `--bare`. Source: [headless → bare mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode).
- The Agent SDK bundles a native Claude Code binary. `pathToClaudeCodeExecutable` can point it at a separately installed one. Source: [Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart).

### ToS / policy: conflicting signals

**Explicitly disallowed:**

- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." Source: [Legal and compliance → Authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).
- "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods …" Source: [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview); the same note appears in the [Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart).
- Developers building products "including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider." Source: [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).
- Consumer Terms forbid accessing the Services "through automated or non-human means, whether through a bot, script, or otherwise" *"except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it."* Source: [Consumer Terms §3](https://www.anthropic.com/legal/consumer-terms).
- "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice." Source: [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).

**Explicitly allowed or tolerated:**

- Running Claude Code inside a product is allowed under the Commercial Terms if (a) "The Claude Code binary must not be modified … customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key)", and (b) "Each end user must authenticate with their own Anthropic API key, **Claude subscription plan credentials**, or 3P inference provider credential." Source: [Legal and compliance → Can customers offer Claude Code in their products?](https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products).
- The credential section also says it does not "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code". Source: [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." This presumes the SDK is used on subscriptions. Source: [Legal and compliance → Acceptable use](https://code.claude.com/docs/en/legal-and-compliance#acceptable-use).
- Help Center, update of June 15–16 2026: "For now, nothing has changed: Claude Agent SDK, `claude -p`, and **third-party app usage** still draw from your subscription's usage limits." The planned move to a separate monthly "Agent SDK credit", which named "third-party apps that authenticate with your Claude subscription through the Agent SDK", was **paused**. Anthropic said "When we have an update, we'll share it before anything takes effect." Source: [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

**Reconciled reading and remaining uncertainty.** The safe interpretation that fits all of the above is:

- MotionBrief must **not** show a "Sign in with Claude" button, run the OAuth flow, or read, copy, or store the user's Claude tokens. `claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN` pasted into MotionBrief also counts as "collect/store".
- MotionBrief *may* run the unmodified Claude Code binary. If the **user** signed in to Claude Code through Anthropic's own flow (running `claude` in a terminal, then `/login`), Claude Code uses that login itself.

The **unclear** point is whether a third-party app that relies on the user's subscription limits is "offering … rate limits" under the SDK note. The Help Center says such usage currently works. The developer docs say it needs approval. This cannot be resolved from public sources. **Recommendation: email Anthropic ([contact sales](https://www.anthropic.com/contact-sales), linked from the legal page for "questions about permitted authentication methods") before promoting subscription use.** Until they answer, present it as "uses your existing Claude Code setup" and label the risk.

- **Branding:** MotionBrief may "accurately say, in plain text, that your product … runs Claude Code". It must not use Claude Code/Anthropic names or logos in its own product or feature names. Source: [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products). The Agent SDK branding guidance allows "Claude Agent" or "{Name} Powered by Claude" and does **not** permit "Claude Code" or "Claude Code Agent" as the label. Source: [Agent SDK overview → Branding](https://code.claude.com/docs/en/agent-sdk/overview#branding-guidelines). So the UI label should read something like "Claude", not "Claude Code".
- **Terms that bind MotionBrief itself:** "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, including when you use it to power products … you make available to … end users". Source: [overview → License and terms](https://code.claude.com/docs/en/agent-sdk/overview#license-and-terms).

### User setup (subscription path)

1. Install Claude Code, or rely on the SDK's bundled binary.
2. Run `claude` in a terminal and sign in through the browser. On first launch, "Claude Code opens a browser window for you to log in" ([Authentication](https://code.claude.com/docs/en/authentication#log-in-to-claude-code)).
3. In MotionBrief, pick the Claude connector. The app checks that Claude Code is logged in (see §7, `checkAuth`) and never shows its own Claude login.

### Tool use / agent loop / Revisions / streaming

- Built-in Read/Write/Edit/Bash tools, hooks, subagents, MCP, permissions, and "Sessions: Maintain context across exchanges, resume or fork later" ([overview → Capabilities](https://code.claude.com/docs/en/agent-sdk/overview#capabilities)). Resume and fork map directly onto Revisions.
- **Custom in-process tools** via `tool()` + `createSdkMcpServer`. Tools can return text, images, and `structuredContent`, so the agent could call e.g. `render_preview_frame` and *see* the frame ([Custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools)).
- The `tools` option restricts built-ins; `allowedTools`, `permissionMode: "acceptEdits"`, `dontAsk`, and `--permission-prompts none` control approval ([Custom tools → Configure allowed tools](https://code.claude.com/docs/en/agent-sdk/custom-tools#configure-allowed-tools), [headless → Auto-approve tools](https://code.claude.com/docs/en/headless#auto-approve-tools)).
- Streaming: `query()` is an async iterator of messages ([Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)). The CLI offers `--output-format stream-json --include-partial-messages` for token deltas, `system/api_retry` events, and a final `result` with cost and session ID ([headless → Stream responses](https://code.claude.com/docs/en/headless#stream-responses)).
- Resume with `--resume <session_id>` or the SDK equivalent ([headless → Continue conversations](https://code.claude.com/docs/en/headless#continue-conversations)).
- Structured output via `--json-schema` ([headless → Get structured output](https://code.claude.com/docs/en/headless#get-structured-output)).
- **Caveat:** without `--bare`, a session loads the user's `~/.claude` hooks, plugins, MCP servers, and CLAUDE.md, and a `-p` session "shows no workspace trust dialog" ([headless → bare mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)). The subscription path can't use `--bare`, so MotionBrief should pass explicit `tools`/`allowedTools`, a system prompt, and a project-scoped working directory to keep behaviour predictable.

### Cost model

- The subscription is a flat plan fee. Usage draws from the plan's usage limits ([Help Center](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)).
- **Risk:** Anthropic has already announced once, then paused, moving SDK and third-party usage onto a separate capped credit (Pro $20, Max 5x $100, Max 20x $200 per month; overflow at API rates). It may return with notice.
- `--output-format json` reports `total_cost_usd`, but it is a "client-side estimate" ([headless](https://code.claude.com/docs/en/headless#pipe-data-through-claude)).

---

## 3. Option B: Anthropic API key (BYOK) with Opus 5.5

- **Feasibility:** yes, via the **same Agent SDK connector**. Set `ANTHROPIC_API_KEY` for the child process; it takes precedence over the subscription login ([Authentication → precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)). Bare mode also works here ([headless](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)). Alternatively, the plain Client SDK: "You write the tool loop yourself, or let the client SDK's beta tool runner drive it" ([overview → compare table](https://code.claude.com/docs/en/agent-sdk/overview)).
- **ToS:** this is the documented path for third-party developers ("Use the API key authentication methods described in the Quickstart"). The Commercial Terms govern API keys ([overview](https://code.claude.com/docs/en/agent-sdk/overview); [Consumer Terms note](https://www.anthropic.com/legal/consumer-terms)). Constraint: MotionBrief must not pay for or resell usage, and each user brings their own key ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products)). The legal page also states the credential rules do "not restrict how customers provision and manage their own API keys" (same page). Storing the user's *own API key* in the OS keychain is therefore fine; storing Claude.ai tokens is not.
- **User setup:** create a Console account at [platform.claude.com](https://platform.claude.com/), add billing, create a key, and paste it into MotionBrief ([Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)).
- **Tool use / streaming / Revisions:** identical to Option A when run through the Agent SDK.
- **Cost:** Claude Opus 5.5 costs **$4 / MTok input, $20 / MTok output**, with cache hits at $0.20 / MTok (0.05× input) and 5-minute cache writes at $5 / MTok. Fast mode costs $8 / $40. There is a full 1M context at standard price. Source: [Pricing](https://platform.claude.com/docs/en/about-claude/pricing). Usage is pay-as-you-go and billed to the user's Console account.

---

## 4. Option C: OpenAI API key and/or Codex (SDK/CLI) with a ChatGPT subscription

### C1. Codex SDK / app-server with an OpenAI API key

- **Feasibility:** yes. The Codex SDK lets you "Integrate Codex within your own application". The TypeScript SDK "spawns the CLI and exchanges JSONL events over stdin/stdout". It supports threads, `resumeThread()`, `runStreamed()` with "tool calls, streaming responses, and file change notifications", and `outputSchema`. Sources: [Codex SDK](https://developers.openai.com/codex/sdk), [TS SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md).
- The Codex **app-server** is "the interface Codex uses to power rich clients … authentication, conversation history, approvals, and streamed agent events" (`thread/start`, `turn/start`, `item/agentMessage/delta`, `turn/completed`) ([App Server](https://developers.openai.com/codex/app-server)).
- **ToS:** API use is under OpenAI's Business Terms ([Terms of Use](https://openai.com/policies/row-terms-of-use/) points API use to the [Business Terms](https://openai.com/policies/business-terms/)). OpenAI says to "Use API key authentication for programmatic Codex CLI workflows" ([Codex auth](https://developers.openai.com/codex/auth)).
- **Cost:** "OpenAI bills API key usage through your OpenAI Platform account at standard API rates" ([Codex auth](https://developers.openai.com/codex/auth); [API pricing](https://developers.openai.com/api/docs/pricing)).
- **Setup:** OpenAI Platform account, then an API key, then paste it into the app.

### C2. Codex with the user's ChatGPT plan: two routes

**(i) Sign in with ChatGPT → "ChatGPT plan usage" for open-source apps (officially sanctioned).**

- "For open-source developers: Let users run AI workloads in your tools with their ChatGPT plan, without requiring them to provide an API key. The open-source sign-in flow registers your client and issues OAuth credentials … without a client secret or partner API key." Also: "ChatGPT plan usage is available to all open-source partners and selected private clients." Source: [SIWC Quickstart](https://developers.openai.com/siwc/quickstart).
- Flow: dynamic client registration (`client_id=dynamic_agent_client`, `agent_name_hint`, a persisted `ext_agent_host_id`), PKCE in the **system browser**, a loopback callback on `127.0.0.1`, and scopes `offline_access resource.invoke chatgpt.tokens.use.direct`. The app stores the tokens itself (a `0600` file) and refreshes them. Source: [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
- Codex app-server can use that token: it takes `ACCESS_TOKEN` via a custom `model_provider` with `base_url="https://api.openai.com/v1"`, and "No separate Codex sign-in is required". The app must refresh the token, restart app-server, and `thread/resume`. Source: [SIWC → Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).
- **Preview limitations:** requests use `store:false` and `stream:true` only. There are no hosted tools (image generation, file search, Code Interpreter, hosted MCP), and **audio input is unsupported**. That is fine: the Transcript is derived separately and the agent only needs text. Codex's local shell and MCP tools work. Source: [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
- **UX obligations:** a "Continue with ChatGPT" button, a first-use "You're using your ChatGPT plan" modal, a "Using ChatGPT plan" label, and a "Manage usage" link ([UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines)).
- **Unclear:** the [Request a client ID](https://developers.openai.com/siwc/request-client-id) page says SIWC "is currently offered to a select group of commercial partners" with a waitlist. The OSS flow claims to need no client ID or secret, and the docs say it is open to "all open-source partners". Whether an MIT desktop app qualifies without applying should be confirmed by a test registration. Paid or remotely hosted apps must use the [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/) ([SIWC overview](https://developers.openai.com/siwc/token-sharing-open-source)).

**(ii) Reusing the user's own `codex login`.** The Codex SDK and CLI read cached credentials from `~/.codex/auth.json` or the OS keyring ([Codex auth → Login caching](https://developers.openai.com/codex/auth#login-caching)). "Codex SDK, `codex exec`, and scriptable workflows" is listed as available on Plus/Pro/Business ([Codex pricing → Feature availability](https://developers.openai.com/codex/pricing)). Nothing found explicitly forbids a third-party app from spawning the user's logged-in Codex CLI. OpenAI documents route (i) as *the* path for third-party apps, though, so prefer it. The consumer Terms of Use ban "Automatically or programmatically extract data or Output" ([Terms of Use](https://openai.com/policies/row-terms-of-use/)); OpenAI's own SDK docs sanction programmatic Codex use, so this is **low-risk but not explicitly addressed for third-party apps**.

- **Cost (plan):** Plus is $20/mo; Pro is $100/$200/$500. Usage limits are per 5 hours plus weekly (e.g. GPT-6.1 Sol: 15–160 local messages per 5h on Plus), with extra credits available ([Codex pricing](https://developers.openai.com/codex/pricing)).

---

## 5. Comparison

| | A. Claude subscription via Claude Code | B. Anthropic API key | C1. OpenAI key + Codex | C2(i). ChatGPT plan via SIWC |
|---|---|---|---|---|
| Technically feasible | Yes | Yes | Yes | Yes (preview) |
| ToS status | **Unclear/conflicting**: allowed only if the unmodified binary and user's own login are used and MotionBrief never handles login; SDK note says approval needed | **Explicitly allowed** | **Explicitly allowed** | **Explicitly allowed for OSS apps** (preview; eligibility to confirm) |
| User setup | Install Claude Code, `/login` in terminal | Console key → paste | Platform key → paste | "Continue with ChatGPT" in-app |
| Who implements login | Claude Code (not us) | n/a | n/a | **MotionBrief** (OAuth PKCE, token storage, refresh) |
| File writes / agent loop | Built in | Built in (same SDK) | Built in | Built in (Codex local tools) |
| Custom host tools | In-process MCP (`createSdkMcpServer`) | same | MCP | MCP |
| Revisions (resume) | Sessions resume/fork | same | `resumeThread` | `thread/resume` (local history) |
| Streaming | Yes | Yes | Yes | Yes |
| Cost to user | Plan limits (policy may change) | $4/$20 per MTok (Opus 5.5) | API rates | Plan limits + credits |
| Model | Opus 5.5 (owner's target) | Opus 5.5 | GPT models | GPT models |

---

## 6. Recommendation: first connector

**Ship one "Claude" connector built on the Claude Agent SDK (TypeScript),** running the unmodified Claude Code binary, with Opus 5.5 as the default model.

- **Auth tier 1 (documented, default in docs and onboarding):** the user's Anthropic API key, stored in the OS keychain and passed to the child as `ANTHROPIC_API_KEY`.
- **Auth tier 2 (owner's preference; ToS-caveated):** "Use my existing Claude Code login". MotionBrief sets no API key, does not use `--bare`, and lets Claude Code use the login the user created with `claude` → `/login`. MotionBrief never renders a Claude login, never reads `.credentials.json` or the keychain entry, and never accepts a pasted `setup-token`. Onboarding copy links to Anthropic's docs and tells the user to sign in to Claude Code themselves.
- **Before promoting tier 2 publicly:** ask Anthropic for written confirmation, via the contact route on the [legal page](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use). Keep tier 1 fully working so a policy change can't break the product.
- **Naming:** label the connector "Claude" (or "Claude Agent"), not "Claude Code". Plain text may say it "runs Claude Code".

Why this over the alternatives:

- One implementation covers both the owner's preferred subscription path and the explicitly allowed BYOK path.
- It provides file tools, sessions (Revisions), streaming, permissions and custom MCP tools out of the box.
- MotionBrief never owns a login flow.
- **Next connector:** Codex via app-server with SIWC ChatGPT-plan usage, the cleanest ToS story for subscriptions, plus an OpenAI API-key fallback.

---

## 7. Minimal connector interface

These are the minimum capabilities, derived from what both the Agent SDK and Codex app-server expose so that either can sit behind the interface.

1. **Identity & capabilities:** `id`, `displayName`, and `capabilities` flags: `authMethods` (`apiKey`, `externalLogin` as in "your Claude Code login", `oauth` for SIWC), `supportsResume`, `supportsFork`, `supportsImagesInToolResults`, `models[]`.
2. **Auth status and setup, owned by the connector:**
   - `checkAuth() → { state: ready | needsSetup | expired, method, accountLabel? }`
   - `setupSteps()` returns the connector-specific instructions and actions: an API-key field, "open terminal and run `claude`", or "Continue with ChatGPT".
   - The host UI never handles subscription tokens itself. That keeps Anthropic's rule enforceable per connector.
3. **Session lifecycle (a video project maps to one agent session):**
   - `startSession({ workspaceDir, instructions, model, hostTools, fileScope }) → sessionId`
   - `resumeSession(sessionId)`, persisted so Revisions survive restarts
   - optional `forkSession(sessionId)` for "try another take"
   - `dispose()`
4. **Turns:** `sendTurn(sessionId, message, attachments?) → AsyncIterable<AgentEvent>`, where `AgentEvent` is a normalized union:
   - `textDelta`
   - `toolCallStarted` / `toolCallCompleted`
   - `fileChanged { path }`
   - `usage { inputTokens, outputTokens, costEstimate?, planUsage? }`
   - `retrying { attempt, delayMs }`
   - `turnCompleted { status: completed | failed | interrupted, error? }`
5. **Interrupt:** `interrupt(sessionId)`, which ends the turn cleanly (the Agent SDK has `interrupt()`, Codex has turn interrupts).
6. **Host tools, provided by MotionBrief, exposed to every connector via MCP:** examples are `get_transcript`, `get_style_preset`, `write_composition` / `validate_composition`, and `render_preview_frame` (returns an image). Both SDKs speak MCP, so the tools are written once. The connector's job is to mount them.
7. **Sandboxing policy:** writes are restricted to the project `workspaceDir`, and shell is off by default. Mapping: Agent SDK `tools` / `allowedTools` / `permissionMode`; Codex `Sandbox.workspace_write` / approval policy.
8. **Error taxonomy, normalized:** `authRequired`, `usageLimitReached` (with a "manage usage" link where the vendor requires one), `modelUnavailable`, `rateLimited`, `network`, and `toolError`.

---

## 8. Open questions / uncertainties

- **Anthropic subscription path.** The developer docs ("does not allow … offer claude.ai login or rate limits" without approval) conflict with the Help Center ("third-party app usage still draw from your subscription's usage limits"). This needs written confirmation from Anthropic. Anthropic may also revive the paused "Agent SDK credit" change, which would move subscription SDK usage to a capped monthly credit.
- **SIWC OSS eligibility.** It is unclear whether MotionBrief can use dynamic registration without applying. The docs say "all open-source partners", while the client-ID page says "select group of commercial partners". Confirm by a test registration.
- **Consumer terms.** Anthropic's Consumer Terms ban automated access "except … via an Anthropic API Key or where we otherwise explicitly permit it". The subscription path relies on the legal page's "unmodified binary" language and the Help Center counting as such permission.
- **Runtime.** The Agent SDK needs Node 18+ (or Python 3.10+) as a sidecar. It bundles a platform binary through npm optional dependencies (none for Python on ARM64 Windows) ([Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)). The packaging impact depends on the app-shell decision.
