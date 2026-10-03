import type { AuthMethod, Result } from "../connector";

/** What MotionBrief keeps about the Claude connection: the chosen method and the user's own API key. */
export type StoredConnection = {
  method?: AuthMethod;
  apiKey?: string;
};

export type StoreError = { code: "STORE_FAILED"; message: string };

/**
 * Where the connection is kept. In the app it is main's Electron safeStorage (the OS keychain),
 * which the core reaches over its parent port; modules never see Electron. Never write it into a Project.
 */
export type ConnectionStore = {
  load: () => Promise<Result<StoredConnection, StoreError>>;
  save: (connection: StoredConnection) => Promise<Result<null, StoreError>>;
};

/** A store that forgets on exit, for tests and for a core started without the app around it. */
export function memoryConnectionStore(initial: StoredConnection = {}): ConnectionStore {
  let stored = { ...initial };

  return {
    load: async () => ({ data: { ...stored }, error: null }),
    save: async (connection) => {
      stored = { ...connection };
      return { data: null, error: null };
    },
  };
}
