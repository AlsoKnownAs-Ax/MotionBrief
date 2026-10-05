import { z } from "zod";
import { EXPORTS_HOLD_CHANNEL, type ExportsHoldRequest, type ExportsHoldResponse } from "../shared/ipc";
import type { ExportsHold } from "./updates";

// Comes from the core process.
const ResponseSchema = z.object({ channel: z.literal(EXPORTS_HOLD_CHANNEL), id: z.number(), running: z.number() }) satisfies z.ZodType<ExportsHoldResponse>;

/** A core that hasn't answered by then is down or restarting: no restart into an update then. */
const ANSWER_TIMEOUT_MS = 5_000;

/** Main's end of the exports hold: requests go to the core, and the core's answers come back through handle(). */
export function coreExportsHold(send: (message: ExportsHoldRequest) => void) {
  const pending = new Map<number, (running: number | undefined) => void>();
  let nextId = 0;

  function request(hold: boolean) {
    nextId += 1;
    const id = nextId;

    return new Promise<number | undefined>((resolve) => {
      const timer = setTimeout(() => settle(undefined), ANSWER_TIMEOUT_MS);
      const settle = (running: number | undefined) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(running);
      };
      pending.set(id, settle);
      send({ channel: EXPORTS_HOLD_CHANNEL, id, hold });
    });
  }

  const hold: ExportsHold = {
    hold: () => request(true),
    release: () => void request(false),
  };

  return {
    ...hold,
    /** Settles the request a core message answers; false for messages on other channels. */
    handle(message: unknown) {
      const { success, data: response } = ResponseSchema.safeParse(message);

      if (!success) {
        return false;
      }

      pending.get(response.id)?.(response.running);
      return true;
    },
  };
}
