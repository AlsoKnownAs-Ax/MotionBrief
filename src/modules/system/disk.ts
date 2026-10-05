import { statfs } from "node:fs/promises";

/** The disk as the core sees it. Swapped in tests to fake a full disk. */
export type Disk = {
  /** Bytes the current user can still write on the volume holding `dir`, which must exist. */
  freeBytes: (dir: string) => Promise<number>;
};

export const realDisk: Disk = {
  freeBytes: async (dir) => {
    const { bavail, bsize } = await statfs(dir);

    return bavail * bsize;
  },
};
