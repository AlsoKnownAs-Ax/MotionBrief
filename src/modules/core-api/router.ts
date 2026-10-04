import { implement } from "@orpc/server";
import { coreContract, type CheckerUnavailable, type SetupResult } from "../../contract";
import type { Checker, CheckerError } from "../checker";
import type { ConnectionStatus, Connector, Result, SetupError } from "../connector";
import { validateStoryboard } from "../storyboard";
import { BUNDLED_PALETTES, FONT_PAIRINGS, listPresets } from "../style";
import type { System } from "../system";
import type { TranscriptionModel } from "../transcription-model";

export type CoreRouterDeps = {
  system: System;
  checker: Checker;
  connector: Connector;
  transcriptionModel: TranscriptionModel;
};

export type CoreRouter = ReturnType<typeof createCoreRouter>;

/** The core API: implements the contract by delegating to the modules. Owns no logic. */
export function createCoreRouter({ system, checker, connector, transcriptionModel }: CoreRouterDeps) {
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
    checker: {
      check: api.checker.check.handler(async ({ input, errors }) => {
        const { data: report, error } = await checker.check(input);

        if (error?.code === "INVALID_STORYBOARD") {
          throw errors.INVALID_STORYBOARD({ data: { issues: error.issues } });
        }

        if (error?.code === "UNKNOWN_UNIT") {
          throw errors.UNKNOWN_UNIT({ data: { unit: error.unit, units: error.units } });
        }

        if (error) {
          throw errors.CHECKER_UNAVAILABLE({ data: unavailable(error) });
        }

        return report;
      }),
    },
    style: {
      presets: api.style.presets.handler(() => listPresets()),
      palettes: api.style.palettes.handler(() => structuredClone([...BUNDLED_PALETTES])),
      typography: api.style.typography.handler(() => structuredClone([...FONT_PAIRINGS])),
    },
    connection: {
      status: api.connection.status.handler(() => connector.status()),
      useLogin: api.connection.useLogin.handler(async () => setupResult(await connector.setup.useLogin())),
      signIn: api.connection.signIn.handler(async ({ signal }) => setupResult(await connector.setup.signIn(signal))),
      setApiKey: api.connection.setApiKey.handler(async ({ input }) => setupResult(await connector.setup.setApiKey(input.apiKey))),
      removeApiKey: api.connection.removeApiKey.handler(async () => setupResult(await connector.setup.removeApiKey())),
    },
    transcriptionModel: {
      status: api.transcriptionModel.status.handler(() => transcriptionModel.status()),
      watch: api.transcriptionModel.watch.handler(({ signal }) => transcriptionModel.watch(signal)),
      start: api.transcriptionModel.start.handler(() => transcriptionModel.start()),
      pause: api.transcriptionModel.pause.handler(() => transcriptionModel.pause()),
      resume: api.transcriptionModel.resume.handler(() => transcriptionModel.resume()),
      import: api.transcriptionModel.import.handler(({ input }) => transcriptionModel.import(input.path)),
    },
  });
}

function unavailable(error: Exclude<CheckerError, { code: "INVALID_STORYBOARD" | "UNKNOWN_UNIT" }>): CheckerUnavailable {
  if (error.code === "CHROME_MISSING") {
    return { cause: error.code, detail: error.path };
  }

  if (error.code === "HYPERFRAMES_FAILED") {
    return { cause: error.code, detail: error.output };
  }

  return { cause: error.code, detail: error.message };
}
