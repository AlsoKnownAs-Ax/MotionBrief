import { implement } from "@orpc/server";
import { coreContract } from "../../contract";
import { validateStoryboard } from "../storyboard";
import type { System } from "../system";

export type CoreRouterDeps = {
  system: System;
};

export type CoreRouter = ReturnType<typeof createCoreRouter>;

/** The core API: implements the contract by delegating to the modules. Owns no logic. */
export function createCoreRouter({ system }: CoreRouterDeps) {
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
  });
}
