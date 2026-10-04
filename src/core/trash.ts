import { z } from "zod";
import type { Trash } from "../modules/projects";
import { TRASH_CHANNEL, type TrashRequest } from "../shared/ipc";

/** The core end of the utilityProcess parent port, as far as the Trash needs it. */
type ParentPort = {
  postMessage: (message: unknown) => void;
  on: (event: "message", listener: (event: { data: unknown }) => void) => void;
};

const ResponseSchema = z.object({ channel: z.literal(TRASH_CHANNEL), id: z.number(), error: z.string().optional() });

/** Moves folders to the OS Trash through main's shell, reached over the parent port. */
export function parentPortTrash(port: ParentPort): Trash {
  const pending = new Map<number, (error?: string) => void>();
  let nextId = 0;

  port.on("message", ({ data }) => {
    const { success, data: response } = ResponseSchema.safeParse(data);

    if (!success) {
      return;
    }

    pending.get(response.id)?.(response.error);
    pending.delete(response.id);
  });

  return async (path) => {
    nextId += 1;
    const request: TrashRequest = { channel: TRASH_CHANNEL, id: nextId, path };
    const error = await new Promise<string | undefined>((resolve) => {
      pending.set(request.id, resolve);
      port.postMessage(request);
    });

    if (error) {
      throw new Error(error);
    }
  };
}
