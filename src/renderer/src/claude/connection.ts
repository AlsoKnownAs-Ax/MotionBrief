import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { core, orpc, queryClient } from "@renderer/core/connection";
import { useNavigation } from "@renderer/navigation";
import type { ConnectionStatus, SetupError, SetupResult } from "../../../contract";

/** The Claude connection, checked at launch and whenever a step changes it. Spends no tokens. */
export function useClaudeStatus() {
  return useQuery(orpc.connection.status.queryOptions({ staleTime: Infinity }));
}

function showStatus({ status }: SetupResult) {
  queryClient.setQueryData(orpc.connection.status.queryKey(), status);
}

export function useCheckAgain() {
  return useMutation({
    mutationFn: () => core.connection.status(),
    onSuccess: (status) => queryClient.setQueryData(orpc.connection.status.queryKey(), status),
  });
}

export function useChooseLogin() {
  return useMutation({ mutationFn: () => core.connection.useLogin(), onSuccess: showStatus });
}

export function useSetApiKey() {
  return useMutation({ mutationFn: (apiKey: string) => core.connection.setApiKey({ apiKey }), onSuccess: showStatus });
}

export function useRemoveApiKey() {
  return useMutation({ mutationFn: () => core.connection.removeApiKey(), onSuccess: showStatus });
}

/** Runs the bundled `claude auth login` until the browser sign-in ends; `cancel` stops it. */
export function useSignIn() {
  const abort = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      abort.current = new AbortController();
      return core.connection.signIn(undefined, { signal: abort.current.signal });
    },
    onSuccess: showStatus,
  });

  return { ...mutation, cancel: () => abort.current?.abort() };
}

/** For Generate: runs `action` when Claude is connected, otherwise opens the Connect step. */
export function useRequireClaude() {
  const { data: status } = useClaudeStatus();
  const openSetup = useNavigation((state) => state.openSetup);

  return (action: () => void) => {
    if (status?.isConnected) {
      action();
      return;
    }

    openSetup("connect-claude");
  };
}

/** "you@example.com · Max", from the account Claude reports. */
export function accountLabel(login: NonNullable<ConnectionStatus["login"]>) {
  return [login.email ?? "Claude account", planName(login.plan)].filter(Boolean).join(" · ");
}

/** "max" → "Max". */
function planName(plan: string | undefined) {
  if (!plan) {
    return undefined;
  }

  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
}

export const SETUP_ERROR_MESSAGES = {
  NO_LOGIN: "Claude isn’t signed in on this computer yet. Sign in, then check again.",
  SIGN_IN_FAILED: "Sign-in didn’t finish. Try again.",
  SIGN_IN_CANCELLED: "Sign-in cancelled.",
  KEY_REJECTED: "Anthropic rejected that key. Check it in the Claude Console and paste it again.",
  KEY_CHECK_FAILED: "Couldn’t reach Anthropic to check the key. Check your connection and try again.",
  KEY_STORE_FAILED: "The key couldn’t be saved in your system keychain.",
} satisfies Record<SetupError["code"], string>;

/** Days left on the subscription login when it's close enough to warn about (3 days or fewer). */
export function expiringInDays(status: ConnectionStatus | undefined) {
  if (status?.method !== "subscription" || status.expiresInDays === undefined || status.expiresInDays > 3) {
    return undefined;
  }

  return status.expiresInDays;
}
