import { isAbsolute } from "node:path";
import { shell } from "electron";
import { z } from "zod";
import { TRASH_CHANNEL, type TrashResponse } from "../shared/ipc";

const RequestSchema = z.object({ channel: z.literal(TRASH_CHANNEL), id: z.number(), path: z.string() });

/**
 * Answers the core's requests to move a deleted Project folder to the Trash or Recycle Bin. Returns undefined for
 * messages on other channels, so the caller can route them elsewhere.
 */
export async function handleTrashMessage(message: unknown): Promise<TrashResponse | undefined> {
  const { success, data: request } = RequestSchema.safeParse(message);

  if (!success) {
    return undefined;
  }

  const reply = { channel: TRASH_CHANNEL, id: request.id } as const;

  if (!isAbsolute(request.path)) {
    return { ...reply, error: `Not an absolute path: ${request.path}` };
  }

  return shell.trashItem(request.path).then(
    () => reply,
    (error: unknown) => ({ ...reply, error: String(error) }),
  );
}
