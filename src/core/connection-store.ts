import { z } from "zod";
import type { ConnectionStore, StoredConnection } from "../modules/claude";
import { CONNECTION_STORE_CHANNEL, type ConnectionStoreRequest } from "../shared/ipc";

/** The core end of the utilityProcess parent port, as far as the store needs it. */
type ParentPort = {
  postMessage: (message: unknown) => void;
  on: (event: "message", listener: (event: { data: unknown }) => void) => void;
};

const ResponseSchema = z.object({
  channel: z.literal(CONNECTION_STORE_CHANNEL),
  id: z.number(),
  connection: z.object({ method: z.enum(["subscription", "api-key"]).optional(), apiKey: z.string().optional() }).optional(),
  error: z.string().optional(),
});

type Response = z.infer<typeof ResponseSchema>;

/** Keeps the Claude connection in main's safeStorage, reached over the parent port. */
export function parentPortConnectionStore(port: ParentPort): ConnectionStore {
  const pending = new Map<number, (response: Response) => void>();
  let nextId = 0;

  port.on("message", ({ data }) => {
    const { success, data: response } = ResponseSchema.safeParse(data);

    if (!success) {
      return;
    }

    pending.get(response.id)?.(response);
    pending.delete(response.id);
  });

  function request(save?: StoredConnection) {
    nextId += 1;
    const message: ConnectionStoreRequest = { channel: CONNECTION_STORE_CHANNEL, id: nextId, save };

    return new Promise<Response>((resolve) => {
      pending.set(message.id, resolve);
      port.postMessage(message);
    });
  }

  return {
    load: async () => {
      const { connection, error } = await request();

      if (error) {
        return { data: null, error: { code: "STORE_FAILED", message: error } };
      }

      return { data: connection ?? {}, error: null };
    },
    save: async (connection) => {
      const { error } = await request(connection);

      if (error) {
        return { data: null, error: { code: "STORE_FAILED", message: error } };
      }

      return { data: null, error: null };
    },
  };
}
