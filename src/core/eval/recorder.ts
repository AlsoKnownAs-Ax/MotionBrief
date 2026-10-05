import type { AgentEvent, Connector, PlanUsage, Session } from "../../modules/connector";

export type RecordedTurn = { message: string; events: AgentEvent[] };

/** One agent session as the eval saw it: what it ran for, on which model, and every turn. */
export type RecordedSession = {
  label: string;
  model: string;
  turns: RecordedTurn[];
};

/** Where a recording is at: `since` and `planSince` answer with what came after it. */
export type RecordingMark = { sessions: number; plan: number };

/** The host tools agents hand their work in through, named as the connector mounts them (`mcp__<server>__<tool>`). */
export const SUBMIT_TOOLS = {
  storyboard: "submit_storyboard",
  sceneCode: "submit_scene_code",
  patch: "submit_patch",
  review: "submit_review",
} as const;

/**
 * Wraps a connector so every session, turn and event goes through unchanged and is recorded on the way: the eval
 * measures the run from the recording.
 */
export function createRecorder(connector: Connector) {
  const sessions: RecordedSession[] = [];
  /** Every plan-usage report, in the order they came across all sessions, so a window's use can be followed over time. */
  const plan: PlanUsage[] = [];

  const recording: Connector = {
    ...connector,
    startSession: async (options) => {
      const { data: session, error } = await connector.startSession(options);

      if (error) {
        return { data: null, error };
      }

      const recorded: RecordedSession = { label: options.label ?? "", model: options.model, turns: [] };
      sessions.push(recorded);

      return { data: recordedSession(session, recorded, plan), error: null };
    },
  };

  return {
    connector: recording,
    mark: (): RecordingMark => ({ sessions: sessions.length, plan: plan.length }),
    /** The sessions started after `mark`. */
    since: (mark: RecordingMark) => sessions.slice(mark.sessions),
    /** The plan-usage reports that came after `mark`, in order. */
    planSince: (mark: RecordingMark) => plan.slice(mark.plan),
  };
}

export type Recorder = ReturnType<typeof createRecorder>;

function recordedSession(session: Session, recorded: RecordedSession, plan: PlanUsage[]): Session {
  return {
    id: () => session.id(),
    sendTurn: (message) => recordedTurn(session.sendTurn(message), message, recorded, plan),
    interrupt: () => session.interrupt(),
    close: () => session.close(),
  };
}

async function* recordedTurn(events: AsyncIterable<AgentEvent>, message: string, recorded: RecordedSession, plan: PlanUsage[]): AsyncIterable<AgentEvent> {
  const turn: RecordedTurn = { message, events: [] };
  recorded.turns.push(turn);

  for await (const event of events) {
    turn.events.push(event);

    if (event.type === "plan-usage") {
      plan.push(event.planUsage);
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

