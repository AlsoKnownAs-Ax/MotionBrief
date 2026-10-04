import { ArrowUpIcon, ClockIcon, MessageSquareIcon, PlayIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import type { RevisionStatus, TimelineScene } from "../../../contract";
import { isGenerating, useGeneration } from "./generation";
import { SCENE_TYPE_LABELS, sceneName } from "./labels";
import { useOpenVideo } from "./open-video";
import { chatLines, isRevising, nameOf, queuedCount, useRevision, type ChatMessage } from "./revision";

/** The Chat tab: flagged Scenes, the conversation with the Revision agent, and the composer scoped by the selection. */
export function Chat() {
  const scenes = useOpenVideo((state) => state.preview?.timeline.scenes) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Thread scenes={scenes} />
      <QueueBar />
      <Composer scenes={scenes} />
    </div>
  );
}

function Thread({ scenes }: { scenes: TimelineScene[] }) {
  const entries = useRevision((state) => state.chat?.entries);
  const notes = useRevision((state) => state.notes);
  const messages = [...chatLines(entries ?? [], scenes), ...notes];
  const status = useRevision((state) => state.status);
  const generating = useGeneration((state) => isGenerating(state.status));
  const flagged = scenes.filter(({ status: sceneStatus }) => !generating && sceneStatus === "fallback");
  const ref = useRef<HTMLDivElement>(null);
  const working = isRevising(status);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages.length, working]);

  if (messages.length === 0 && flagged.length === 0 && !working) {
    return (
      <div className="m-auto flex max-w-[260px] flex-col items-center gap-2 px-3 py-6 text-center">
        <MessageSquareIcon className="size-5 text-ink-muted" aria-hidden="true" />
        <p className="text-app-sm font-medium">Ask for a change in plain words</p>
        <p className="text-app-xs leading-[1.45] text-ink-muted">
          Select Scenes in the timeline first to scope the request; otherwise it applies to the whole video.
        </p>
      </div>
    );
  }

  return (
    <div ref={ref} role="log" aria-label="Chat" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-0.5 py-1">
      {flagged.map((scene) => (
        <FlagCard key={scene.id} scene={scene} />
      ))}
      {messages.map((message) => (
        <Message key={message.id} message={message} scenes={scenes} />
      ))}
      {working ? <Working status={status} /> : null}
    </div>
  );
}

/** The agent at work, in the thread: reading the request, then rebuilding Scenes. */
function Working({ status }: { status?: RevisionStatus }) {
  return (
    <div role="status" className="flex gap-2.5 text-app-sm leading-[1.45]">
      <span aria-hidden="true" className="mt-[5px] size-2 shrink-0 animate-pulse rounded-full bg-status-working" />
      <span className="flex flex-col gap-0.5">
        <span className="text-app-xs text-ink-muted">Agent · working</span>
        <span>{workingText(status)}</span>
      </span>
    </div>
  );
}

function workingText(status: RevisionStatus | undefined) {
  if (status?.state !== "rebuilding" && status?.state !== "saving") {
    return "Reading the request";
  }

  return `Rebuilding ${status.units.length} ${plural(status.units.length, "Scene")}. The current Version plays until it's ready.`;
}

function plural(count: number, noun: string) {
  if (count === 1) {
    return noun;
  }

  return `${noun}s`;
}

/** A Scene playing as its fallback, with Revise… to ask for it in chat. */
function FlagCard({ scene }: { scene: TimelineScene }) {
  const reviseScenes = useRevision((state) => state.reviseScenes);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline-soft bg-surface-1 p-3">
      <div className="flex items-center gap-2">
        <span className="text-app-sm font-medium">
          {sceneName(scene)} <span className="text-ink-muted">· {SCENE_TYPE_LABELS[scene.type]}</span>
        </span>
        <Badge status="fallback">Fallback</Badge>
      </div>
      <p className="text-app-sm leading-[1.45] text-ink-muted">Its code kept failing the checks, so a plain fallback Scene plays here.</p>
      <div>
        <Button size="sm" variant="ghost" onClick={() => reviseScenes([scene.id])}>
          <MessageSquareIcon />
          Revise…
        </Button>
      </div>
    </div>
  );
}

/** How each kind of chat line is drawn. */
const MESSAGES = {
  creator: ({ message, scenes }) => (
    <div className="max-w-[88%] self-end rounded-[14px_14px_4px_14px] bg-surface-2 px-3 py-[9px] text-app-sm leading-[1.45] whitespace-pre-wrap">
      {message.scope?.length ? (
        <span className="mb-1.5 flex flex-wrap gap-1">
          {message.scope.map((sceneId) => (
            <Chip key={sceneId} label={nameOf(scenes, sceneId)} />
          ))}
        </span>
      ) : null}
      {message.text}
      {message.isQueued ? (
        <span className="mt-1.5 flex items-center gap-[5px] text-app-xs text-ink-muted">
          <ClockIcon className="size-3" aria-hidden="true" />
          Queued
        </span>
      ) : null}
    </div>
  ),
  agent: ({ message }) => (
    <div className="flex gap-2.5 text-app-sm leading-[1.45]">
      <span aria-hidden="true" className="mt-[5px] size-2 shrink-0 rounded-full bg-[#555]" />
      <span className="flex flex-col gap-0.5">
        <span className="text-app-xs text-ink-muted">Agent</span>
        <span>{message.text}</span>
      </span>
    </div>
  ),
  event: ({ message }) => (
    <div className="flex items-center gap-2 text-app-xs text-ink-muted before:h-px before:flex-1 before:bg-hairline after:h-px after:flex-1 after:bg-hairline">
      {message.text}
    </div>
  ),
  note: ({ message }) => <Note message={message} />,
} satisfies Record<ChatMessage["role"], (props: { message: ChatMessage; scenes: TimelineScene[] }) => ReactNode>;

function Message(props: { message: ChatMessage; scenes: TimelineScene[] }) {
  return MESSAGES[props.message.role](props);
}

function Note({ message }: { message: ChatMessage }) {
  if (message.isProblem) {
    return (
      <p role="alert" className="px-3 text-center text-app-xs text-status-fallback-ink">
        {message.text}
      </p>
    );
  }

  return <p className="px-3 text-center text-app-xs text-ink-muted">{message.text}</p>;
}

function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-0.5 rounded-sm bg-primary/13 px-2 text-app-xs font-medium text-primary", onRemove && "pr-[3px]")}>
      {label}
      {onRemove ? (
        <button type="button" aria-label={`Remove ${label} from the request`} className="grid size-[18px] place-items-center rounded-xs hover:bg-primary/20" onClick={onRemove}>
          <XIcon className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

/** What the request applies to: the selected Scenes as chips, or the whole video. */
function ScopeChips({ scenes }: { scenes: TimelineScene[] }) {
  const selection = useRevision((state) => state.selection);
  const toggleScene = useRevision((state) => state.toggleScene);

  if (selection.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-[22px] items-center rounded-sm bg-surface-2 px-2 text-app-xs font-medium text-ink-muted">Whole video</span>
        <span className="text-app-xs text-ink-muted">Select Scenes to narrow the request</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Scenes the request applies to">
      {selection.map((sceneId) => (
        <Chip key={sceneId} label={nameOf(scenes, sceneId)} onRemove={() => toggleScene(sceneId, true)} />
      ))}
    </div>
  );
}

/** The requests waiting their turn, and Resume queue once a quit, crash or Stop paused them. */
function QueueBar() {
  const queued = useRevision((state) => queuedCount(state.chat));
  const isPaused = useRevision((state) => state.chat?.isPaused ?? false);
  const saveError = useRevision((state) => state.chat?.saveError);
  const resumeQueue = useRevision((state) => state.resumeQueue);

  if (queued === 0 && !saveError) {
    return null;
  }

  return (
    <div role="status" className="flex shrink-0 items-center gap-2 rounded-xl border border-hairline py-1.5 pr-1.5 pl-3 text-ink-muted">
      <ClockIcon className="size-3.5" aria-hidden="true" />
      <span className="flex-1 text-app-sm text-ink">
        {queued} queued
        {isPaused ? <span className="text-ink-muted"> · paused</span> : null}
        {saveError ? (
          <span role="alert" className="block text-app-xs text-status-fallback-ink">
            The chat couldn&rsquo;t be saved to {saveError.path || "the Project folder"}. Resume queue tries again.
          </span>
        ) : null}
      </span>
      {isPaused ? (
        <Button size="sm" onClick={resumeQueue}>
          <PlayIcon />
          Resume queue
        </Button>
      ) : null}
    </div>
  );
}

/** What the composer says under the request, first match wins: why it can't send, or where a request goes. */
const HINTS = [
  { when: ({ isStored }: ComposerState) => !isStored, hint: "The fixture Project can't be revised", isBlocked: true },
  { when: ({ isPaused }: ComposerState) => isPaused, hint: "Queues until Resume queue", isBlocked: false },
  { when: ({ isBusy }: ComposerState) => isBusy, hint: "Queues behind the current job", isBlocked: false },
];

type ComposerState = { isStored: boolean; isBusy: boolean; isPaused: boolean };

function Composer({ scenes }: { scenes: TimelineScene[] }) {
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const send = useRevision((state) => state.send);
  const stop = useRevision((state) => state.stop);
  const chatFocus = useRevision((state) => state.chatFocus);
  const working = useRevision((state) => isRevising(state.status));
  const isPaused = useRevision((state) => state.chat?.isPaused ?? false);
  const generating = useGeneration((state) => isGenerating(state.status));
  const isStored = useOpenVideo((state) => state.isStored);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hint = HINTS.find(({ when }) => when({ isStored, isBusy: working || generating, isPaused }));
  const canSend = !hint?.isBlocked && !isSending && text.trim().length > 0;

  useEffect(() => {
    if (chatFocus > 0) {
      textarea.current?.focus();
    }
  }, [chatFocus]);

  async function submit() {
    if (!canSend) {
      return;
    }

    setIsSending(true);
    const sent = await send(text.trim());
    setIsSending(false);

    if (sent) {
      setText("");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-[15px] border border-hairline bg-surface-1 p-2.5 transition-[border-color,box-shadow] focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_12%,transparent)]">
      <ScopeChips scenes={scenes} />
      <textarea
        ref={textarea}
        rows={2}
        value={text}
        placeholder="Describe a change…"
        aria-label="Revision request"
        className="min-h-[42px] resize-none bg-transparent p-0.5 text-app-sm leading-[1.45] outline-none placeholder:text-ink-muted"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-app-xs text-ink-muted">{hint?.hint ?? "Enter to send · Shift+Enter for a new line"}</span>
        {working ? (
          <Button size="icon-sm" aria-label="Stop the Revision" title="Stop the Revision" onClick={stop}>
            <SquareIcon className="size-3 fill-current" />
          </Button>
        ) : null}
        <Button variant="primary" size="icon-sm" aria-label="Send (Enter)" title="Send (Enter)" disabled={!canSend} onClick={() => void submit()}>
          <ArrowUpIcon />
        </Button>
      </div>
    </div>
  );
}
