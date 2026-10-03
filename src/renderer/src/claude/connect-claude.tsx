import { CircleCheckIcon, ExternalLinkIcon, InfoIcon, LoaderCircleIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";
import type { ConnectionStatus, SetupResult } from "../../../contract";
import {
  accountLabel,
  SETUP_ERROR_MESSAGES,
  useCheckAgain,
  useChooseLogin,
  useClaudeStatus,
  useSetApiKey,
  useSignIn,
} from "./connection";

/** Anthropic's own page on which logins third-party apps may use. */
const ANTHROPIC_TERMS_URL = "https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use";

/** The Connect step: the subscription card first, with its permanent caveat; the API key card second. */
export function ConnectClaude() {
  const { data: status, isPending } = useClaudeStatus();
  const [isChanging, setIsChanging] = useState(false);

  if (isPending || !status) {
    return (
      <p className="flex items-center gap-2 text-app-sm text-ink-muted">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
        Checking Claude…
      </p>
    );
  }

  if (status.isConnected && !isChanging) {
    return <Connected status={status} onChange={() => setIsChanging(true)} />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {status.error ? (
        <p role="alert" className="text-app-sm text-status-fallback-ink">
          Claude couldn’t start: {status.error.message}
        </p>
      ) : null}
      <SubscriptionCard status={status} />
      <ApiKeyCard />
    </div>
  );
}

function Connected({ status, onChange }: { status: ConnectionStatus; onChange: () => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-surface-1 px-3 py-2.5">
      <CircleCheckIcon className="size-[18px] shrink-0 text-status-success" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 items-baseline gap-2 text-app-sm">
        Connected
        <span className="truncate text-ink-muted">{connectedLabel(status)}</span>
      </span>
      <Button variant="ghost" size="sm" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}

function connectedLabel(status: ConnectionStatus) {
  if (status.method === "api-key") {
    return `Anthropic API key ${status.maskedKey ?? ""}`;
  }

  if (status.login) {
    return accountLabel(status.login);
  }

  return "Claude account";
}

function Card({ title, badge, description, isSelected, children }: {
  title: string;
  badge?: ReactNode;
  description: string;
  isSelected?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-3 rounded-lg bg-surface-1 p-4",
        isSelected && "bg-surface-2 shadow-[0_0_0_1px_rgb(255_122_61/0.45)]",
      )}
    >
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-app-body font-medium">
          {title}
          {badge}
        </h3>
        <p className="text-app-sm text-ink-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function SubscriptionCard({ status }: { status: ConnectionStatus }) {
  const chooseLogin = useChooseLogin();
  const signIn = useSignIn();
  const checkAgain = useCheckAgain();
  const error = chooseLogin.data?.error ?? signIn.data?.error;

  return (
    <Card
      title="Use my Claude account"
      description="Generation runs on your Claude plan, signed in through Anthropic’s own sign-in."
      isSelected={Boolean(status.login)}
    >
      <LoginControls
        login={status.login}
        chooseLogin={chooseLogin}
        signIn={signIn}
        checkAgain={() => checkAgain.mutate()}
        isChecking={checkAgain.isPending}
      />
      <SetupErrorMessage error={error} />
      <p className="flex gap-1.5 text-app-xs leading-[1.4] text-ink-muted">
        <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Uses your Claude plan’s limits. Anthropic hasn’t confirmed this for third-party apps; an API key is the supported
          path.{" "}
          <a href={ANTHROPIC_TERMS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
            Anthropic’s docs
            <ExternalLinkIcon className="size-3" aria-hidden="true" />
          </a>
        </span>
      </p>
    </Card>
  );
}

/** A detected login only needs confirming; without one, Anthropic's sign-in runs from here. */
function LoginControls({ login, chooseLogin, signIn, checkAgain, isChecking }: {
  login: ConnectionStatus["login"];
  chooseLogin: ReturnType<typeof useChooseLogin>;
  signIn: ReturnType<typeof useSignIn>;
  checkAgain: () => void;
  isChecking: boolean;
}) {
  if (login) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex flex-1 items-center gap-2 text-app-sm">
          {accountLabel(login)}
          <Badge status="success">Signed in</Badge>
        </span>
        <Button variant="primary" disabled={chooseLogin.isPending} onClick={() => chooseLogin.mutate()}>
          Use this account
        </Button>
      </div>
    );
  }

  if (signIn.isPending) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span role="status" className="flex flex-1 items-center gap-2 text-app-sm text-ink-muted">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          Finish signing in in your browser
        </span>
        <Button variant="ghost" size="sm" onClick={signIn.cancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => signIn.mutate()}>
          <ExternalLinkIcon aria-hidden="true" />
          Sign in with your Claude account (opens Anthropic’s sign-in)
        </Button>
        <Button variant="tertiary" disabled={isChecking} onClick={checkAgain}>
          {busyLabel(isChecking, "Check again")}
        </Button>
      </div>
      <p className="text-app-xs text-ink-muted">Signed in from a terminal instead? Choose Check again.</p>
    </div>
  );
}

function ApiKeyCard() {
  const setApiKey = useSetApiKey();
  const [apiKey, setKey] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    setApiKey.mutate(apiKey, { onSuccess: ({ error }) => clearUnlessFailed(error, () => setKey("")) });
  }

  return (
    <Card
      title="Anthropic API key"
      badge={<Badge>Officially supported</Badge>}
      description="Pay per use through your Claude Console account. The key is checked for free, kept in your system keychain and never written into a Project."
    >
      <ApiKeyForm
        apiKey={apiKey}
        onChange={setKey}
        onSubmit={submit}
        isChecking={setApiKey.isPending}
        error={setApiKey.data?.error}
        submitLabel="Connect"
      />
    </Card>
  );
}

export function ApiKeyForm({ apiKey, onChange, onSubmit, isChecking, error, submitLabel, autoFocus }: {
  apiKey: string;
  onChange: (apiKey: string) => void;
  onSubmit: (event: FormEvent) => void;
  isChecking: boolean;
  error?: SetupResult["error"];
  submitLabel: string;
  autoFocus?: boolean;
}) {
  return (
    <form className="flex flex-col gap-2" onSubmit={onSubmit}>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          aria-label="Anthropic API key"
          aria-invalid={Boolean(error)}
          autoFocus={autoFocus}
          value={apiKey}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button type="submit" variant="tertiary" disabled={!apiKey.trim() || isChecking}>
          {busyLabel(isChecking, submitLabel)}
        </Button>
      </div>
      <SetupErrorMessage error={error} />
    </form>
  );
}

function SetupErrorMessage({ error }: { error?: SetupResult["error"] }) {
  if (!error) {
    return null;
  }

  return (
    <p role="alert" className="text-app-xs text-status-fallback-ink">
      {SETUP_ERROR_MESSAGES[error.code]}
    </p>
  );
}

function busyLabel(isChecking: boolean, label: string) {
  if (isChecking) {
    return "Checking…";
  }

  return label;
}

function clearUnlessFailed(error: SetupResult["error"], clear: () => void) {
  if (error) {
    return;
  }

  clear();
}
