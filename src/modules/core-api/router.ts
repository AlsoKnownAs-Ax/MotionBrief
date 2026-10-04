import { implement, ORPCError } from "@orpc/server";
import { coreContract, type CheckerUnavailable, type SetupResult, type VideoSource } from "../../contract";
import type { Cache } from "../cache";
import type { Checker, CheckerError } from "../checker";
import type { Projects, ProjectsError } from "../projects";
import type { ConnectionStatus, Connector, Result, SetupError } from "../connector";
import type { Previews, ThumbnailsError } from "../preview";
import { validateStoryboard } from "../storyboard";
import { BUNDLED_PALETTES, FONT_PAIRINGS, listPresets } from "../style";
import type { System } from "../system";
import type { TranscriptionModel } from "../transcription-model";

/** The fixture Project development builds open from Home, until Projects open from disk. */
export type SampleProject = { name: string; source: () => Promise<VideoSource> };

export type CoreRouterDeps = {
  system: System;
  checker: Checker;
  connector: Connector;
  transcriptionModel: TranscriptionModel;
  previews: Previews;
  sample?: SampleProject;
  projects: Projects;
  cache: Cache;
};

export type CoreRouter = ReturnType<typeof createCoreRouter>;

/** The core API: implements the contract by delegating to the modules. Owns no logic. */
export function createCoreRouter({ system, checker, connector, transcriptionModel, previews, sample, projects, cache }: CoreRouterDeps) {
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
    preview: {
      open: api.preview.open.handler(async ({ input, errors }) => {
        const { data: preview, error } = await previews.open(input);

        if (error?.code === "INVALID_STORYBOARD") {
          throw errors.INVALID_STORYBOARD({ data: { issues: error.issues } });
        }

        if (error?.code === "UNKNOWN_UNIT") {
          throw errors.UNKNOWN_UNIT({ data: { unit: error.unit, units: error.units } });
        }

        if (error) {
          throw errors.VOICEOVER_MISSING({ data: { path: error.path } });
        }

        return preview;
      }),
      thumbnails: api.preview.thumbnails.handler(async function* ({ input, errors }) {
        const { data: thumbnails, error } = await previews.thumbnails(input.id);

        if (error?.code === "PREVIEW_NOT_FOUND") {
          throw errors.PREVIEW_NOT_FOUND({ data: { id: error.id } });
        }

        if (error) {
          throw errors.CHECKER_UNAVAILABLE({ data: unavailable(error) });
        }

        yield* thumbnails;
      }),
      openSample: api.preview.openSample.handler(async ({ errors }) => {
        if (!sample) {
          throw errors.SAMPLE_UNAVAILABLE();
        }

        const { data: preview, error } = await previews.open(await sample.source());

        if (error) {
          throw new Error(`The fixture Project doesn't open: ${JSON.stringify(error)}`);
        }

        return { name: sample.name, preview };
      }),
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
    project: {
      defaults: api.project.defaults.handler(() => projects.defaults()),
      create: api.project.create.handler(async ({ input }) => dataOrThrow(await projects.create(input))),
      open: api.project.open.handler(async ({ input }) => dataOrThrow(await projects.open(input.path))),
      update: api.project.update.handler(async ({ input: { projectId, ...changes } }) => dataOrThrow(await projects.update(projectId, changes))),
      transcription: api.project.transcription.handler(({ input, signal }) => dataOrThrow(projects.watchTranscription(input.projectId, signal))),
      retryTranscription: api.project.retryTranscription.handler(({ input }) => {
        dataOrThrow(projects.retryTranscription(input.projectId));
      }),
      fixWord: api.project.fixWord.handler(async ({ input }) => dataOrThrow(await projects.fixWord(input.projectId, input.index, input.text))),
      close: api.project.close.handler(({ input }) => projects.close(input.projectId)),
    },
    cache: {
      status: api.cache.status.handler(() => cache.status()),
      clear: api.cache.clear.handler(() => cache.clear()),
    },
  });
}

/** A Project store result as the core API answers it: the data, or the error as the contract defines it. */
function dataOrThrow<T>({ data, error }: ProjectsResult<T>): T {
  if (error) {
    const { code, ...details } = error;
    throw new ORPCError(code, { data: details });
  }

  return data;
}

type ProjectsResult<T> = { data: T; error: null } | { data: null; error: ProjectsError };

function unavailable(
  error: Exclude<CheckerError, { code: "INVALID_STORYBOARD" | "UNKNOWN_UNIT" }> | Exclude<ThumbnailsError, { code: "PREVIEW_NOT_FOUND" }>,
): CheckerUnavailable {
  if (error.code === "CHROME_MISSING") {
    return { cause: error.code, detail: error.path };
  }

  if (error.code === "HYPERFRAMES_FAILED") {
    return { cause: error.code, detail: error.output };
  }

  return { cause: error.code, detail: error.message };
}
