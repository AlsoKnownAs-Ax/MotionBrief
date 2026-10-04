import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { create } from "zustand";
import { accountLabel, useClaudeStatus, useRemoveApiKey, useSetApiKey } from "@renderer/claude/connection";
import { ApiKeyForm } from "@renderer/claude/connect-claude";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
import { core, orpc, queryClient } from "@renderer/core/connection";
import { useNavigation } from "@renderer/navigation";
import { sizeLabel } from "@renderer/new-project/labels";
import type { CacheStatus, ConnectionStatus } from "../../../contract";

export const useSettingsDialog = create<{ isOpen: boolean; setIsOpen: (isOpen: boolean) => void }>((set) => ({
  isOpen: false,
  setIsOpen: (isOpen) => set({ isOpen }),
}));

/** App settings; opened from the title bar or the app menu. Holds the Claude connection for now. */
export function SettingsDialog() {
  const { isOpen, setIsOpen } = useSettingsDialog();

  useEffect(
    () =>
      window.motionbrief.onCommand((command) => {
        if (command === "settings.show") {
          setIsOpen(true);
        }
      }),
    [setIsOpen],
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Changes apply to the next run.</DialogDescription>
        </DialogHeader>
        <ClaudeSettings onOpenSetup={() => setIsOpen(false)} />
        <StorageSettings />
      </DialogContent>
    </Dialog>
  );
}

function ClaudeSettings({ onOpenSetup }: { onOpenSetup: () => void }) {
  const { data: status } = useClaudeStatus();
  const openSetup = useNavigation((state) => state.openSetup);

  return (
    <section aria-labelledby="settings-claude" className="flex flex-col gap-1">
      <h3 id="settings-claude" className="text-app-sm font-medium">
        Claude
      </h3>
      <dl className="flex flex-col">
        <Row label="Connection">
          <span className="text-app-sm text-ink-muted">{connectionLabel(status)}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onOpenSetup();
              openSetup("connect-claude");
            }}
          >
            Change…
          </Button>
        </Row>
        <ApiKeyRow maskedKey={status?.maskedKey} />
      </dl>
    </section>
  );
}

function connectionLabel(status: ConnectionStatus | undefined) {
  if (!status) {
    return "Checking…";
  }

  if (!status.isConnected) {
    return "Not connected";
  }

  if (status.method === "api-key") {
    return "API key";
  }

  if (status.login) {
    return accountLabel(status.login);
  }

  return "Claude account";
}

/** The stored key, masked, with Replace and Remove. The key itself never reaches the window. */
function ApiKeyRow({ maskedKey }: { maskedKey?: string }) {
  const setApiKey = useSetApiKey();
  const removeApiKey = useRemoveApiKey();
  const [isEditing, setIsEditing] = useState(false);
  const [apiKey, setKey] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    setApiKey.mutate(apiKey, {
      onSuccess: ({ error }) => {
        if (error) {
          return;
        }

        setKey("");
        setIsEditing(false);
      },
    });
  }

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 py-2">
        <dt className="text-app-sm">API key</dt>
        <dd className="flex flex-col gap-2">
          <ApiKeyForm
            apiKey={apiKey}
            onChange={setKey}
            onSubmit={submit}
            isChecking={setApiKey.isPending}
            error={setApiKey.data?.error}
            submitLabel="Save"
            autoFocus
          />
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setIsEditing(false)}>
            Cancel
          </Button>
        </dd>
      </div>
    );
  }

  if (!maskedKey) {
    return (
      <Row label="API key">
        <span className="text-app-sm text-ink-muted">None</span>
        <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
          Add
        </Button>
      </Row>
    );
  }

  return (
    <Row label="API key">
      <span className="font-mono text-app-sm text-ink-muted">{maskedKey}</span>
      <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
        Replace
      </Button>
      <Button variant="ghost" size="sm" disabled={removeApiKey.isPending} onClick={() => removeApiKey.mutate()}>
        Remove
      </Button>
    </Row>
  );
}

/** The app cache: resampled audio and raw Whisper output, all of which MotionBrief can make again. */
function StorageSettings() {
  const { data: status } = useQuery(orpc.cache.status.queryOptions());
  const clear = useMutation({
    mutationFn: () => core.cache.clear(),
    onSuccess: (cleared) => queryClient.setQueryData(orpc.cache.status.queryKey(), cleared),
  });

  return (
    <section aria-labelledby="settings-storage" className="flex flex-col gap-1">
      <h3 id="settings-storage" className="text-app-sm font-medium">
        Storage
      </h3>
      <dl className="flex flex-col">
        <Row label="Cache">
          <span className="text-app-sm text-ink-muted tabular-nums">{cacheLabel(status)}</span>
          <Button variant="ghost" size="sm" disabled={clear.isPending || status?.usedBytes === 0} onClick={() => clear.mutate()}>
            Clear cache
          </Button>
        </Row>
      </dl>
      <p className="text-app-xs text-ink-muted">Resampled audio and raw transcriptions. Clearing it never touches a Project.</p>
    </section>
  );
}

function cacheLabel(status: CacheStatus | undefined) {
  if (!status) {
    return "Checking…";
  }

  return `${sizeLabel(status.usedBytes)} of ${sizeLabel(status.capBytes)}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-hairline-soft last:border-0">
      <dt className="flex-1 text-app-sm">{label}</dt>
      <dd className="flex items-center gap-1">{children}</dd>
    </div>
  );
}
