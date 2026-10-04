import type { AgentEvent, Connector, ModelUsage, PlanUsage, Session } from "../../modules/connector";

export type RecordedTurn = { message: string; events: AgentEvent[] };

/** One agent session as the eval saw it: what it ran for, on which model, every turn, and what it cost. */
export type RecordedSession = {
  label: string;
  model: string;
  turns: RecordedTurn[];
  /** The session's usage so far: Claude reports session totals, so the last report is the session's. */
  usage: ModelUsage[];
  costUsd: number;
  planUsage: PlanUsage[];
};

/** The host tools agents hand their work in through, named as the connector mounts them (`mcp__<server>__<tool>`). */
export const SUBMIT_TOOLS = {
  storyboard: "submit_storyboard",
  sceneCode: "submit_scene_code",
  patch: "submit_patch",
  review: "submit_review",
} as const;

/**
 * Wraps a connector so every session, turn and event goes through unchanged and is recorded on the way: the eval
 * measures the run from the recording, and its text outputs become replays.
 */
export function createRecorder(connector: Connector) {
  const sessions: RecordedSession[] = [];

  const recording: Connector = {
    ...connector,
    startSession: async (options) => {
      const { data: session, error } = await connector.startSession(options);

      if (error) {
        return { data: null, error };
      }

      const recorded: RecordedSession = { label: options.label ?? "", model: options.model, turns: [], usage: [], costUsd: 0, planUsage: [] };
      sessions.push(recorded);

      return { data: recordedSession(session, recorded), error: null };
    },
  };

  return {
    connector: recording,
    /** Where the recording is now; `since` gives the sessions started after it. */
    mark: () => sessions.length,
    since: (mark: number) => sessions.slice(mark),
  };
}

export type Recorder = ReturnType<typeof createRecorder>;

function recordedSession(session: Session, recorded: RecordedSession): Session {
  return {
    id: () => session.id(),
    sendTurn: (message) => recordedTurn(session.sendTurn(message), message, recorded),
    interrupt: () => session.interrupt(),
    close: () => session.close(),
  };
}

async function* recordedTurn(events: AsyncIterable<AgentEvent>, message: string, recorded: RecordedSession): AsyncIterable<AgentEvent> {
  const turn: RecordedTurn = { message, events: [] };
  recorded.turns.push(turn);

  for await (const event of events) {
    turn.events.push(event);

    if (event.type === "usage") {
      recorded.usage = event.usage;
      recorded.costUsd = event.costUsd;
    }

    if (event.type === "plan-usage") {
      recorded.planUsage.push(event.planUsage);
    }

    yield event;
  }
}

/** The sessions whose label is `label`, or starts with it followed by a space (`scene-code` takes `scene-code s03`). */
export function sessionsOf(sessions: RecordedSession[], label: string): RecordedSession[] {
  return sessions.filter((session) => session.label === label || session.label.startsWith(`${label} `));
}

/** What each turn handed in through `tool`, in order: one entry per turn, `undefined` for a turn that handed in nothing. */
export function handedIn(session: RecordedSession, tool: string): unknown[] {
  return session.turns.map(({ events }) => events.findLast((event) => isCallTo(event, tool))).map((event) => event?.input);
}

function isCallTo(event: AgentEvent, tool: string): event is Extract<AgentEvent, { type: "tool-call" }> {
  return event.type === "tool-call" && (event.name === tool || event.name.endsWith(`__${tool}`));
}

/**
 * The recorded turns as a replay script, a list per session label, for the replay connector. Text deltas are left
 * out: a turn's final text is on its `turn-completed`.
 */
export function replayScript(sessions: RecordedSession[]): Record<string, AgentEvent[][]> {
  const turns = sessions.flatMap(({ label, turns }) => turns.map(({ events }) => ({ label, events: events.filter(({ type }) => type !== "text-delta") })));
  const byLabel = Map.groupBy(turns, ({ label }) => label);

  return Object.fromEntries([...byLabel].map(([label, labelled]) => [label, labelled.map(({ events }) => events)]));
}
