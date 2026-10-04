import { implement } from "@orpc/server";
import { coreContract, type CheckerUnavailable } from "../../contract";
import type { Checker, CheckerError } from "../checker";
import { BLUEPRINT } from "../frame";
import { validateStoryboard } from "../storyboard";
import type { System } from "../system";

export type CoreRouterDeps = {
  system: System;
  checker: Checker;
};

export type CoreRouter = ReturnType<typeof createCoreRouter>;

/** The core API: implements the contract by delegating to the modules. Owns no logic. */
export function createCoreRouter({ system, checker }: CoreRouterDeps) {
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
    checker: {
      check: api.checker.check.handler(async ({ input, errors }) => {
        // Blueprint until Style Presets reach the frame.
        const { data: report, error } = await checker.check({ ...input, tokens: BLUEPRINT });

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
