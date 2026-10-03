import { implement } from "@orpc/server";
import { coreContract, type SetupResult } from "../../contract";
import type { ConnectionStatus, Connector, Result, SetupError } from "../connector";
import { validateStoryboard } from "../storyboard";
import type { System } from "../system";

export type CoreRouterDeps = {
  system: System;
  connector: Connector;
};

export type CoreRouter = ReturnType<typeof createCoreRouter>;

/** The core API: implements the contract by delegating to the modules. Owns no logic. */
export function createCoreRouter({ system, connector }: CoreRouterDeps) {
  const api = implement(coreContract);

  /** A failed step still answers with the current status, so the UI never shows a stale one. */
  async function setupResult({ data: status, error }: Result<ConnectionStatus, SetupError>): Promise<SetupResult> {
    if (error) {
      return { status: await connector.status(), error };
    }

    return { status };
  }

  return api.router({
    system: {
      info: api.system.info.handler(() => system.info()),
      heartbeat: api.system.heartbeat.handler(({ signal }) => system.heartbeat(signal)),
    },
    storyboard: {
      validate: api.storyboard.validate.handler(({ input }) => {
        const { error } = validateStoryboard(input.storyboard, input.transcript, input.rules);

        return { issues: error?.issues ?? [] };
      }),
    },
    connection: {
      status: api.connection.status.handler(() => connector.status()),
      useLogin: api.connection.useLogin.handler(async () => setupResult(await connector.setup.useLogin())),
      signIn: api.connection.signIn.handler(async ({ signal }) => setupResult(await connector.setup.signIn(signal))),
      setApiKey: api.connection.setApiKey.handler(async ({ input }) => setupResult(await connector.setup.setApiKey(input.apiKey))),
      removeApiKey: api.connection.removeApiKey.handler(async () => setupResult(await connector.setup.removeApiKey())),
    },
  });
}
