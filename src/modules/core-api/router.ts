import { implement } from "@orpc/server";
import { coreContract } from "../../contract";
import { validateStoryboard } from "../storyboard";
import type { System } from "../system";
import type { TranscriptionModel } from "../transcription-model";

export type CoreRouterDeps = {
  system: System;
  transcriptionModel: TranscriptionModel;
};

export type CoreRouter = ReturnType<typeof createCoreRouter>;

/** The core API: implements the contract by delegating to the modules. Owns no logic. */
export function createCoreRouter({ system, transcriptionModel }: CoreRouterDeps) {
  const api = implement(coreContract);

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
