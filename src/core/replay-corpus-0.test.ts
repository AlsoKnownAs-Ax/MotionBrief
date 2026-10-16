import { describe } from "vitest";
import { describeReplay, replayPartition } from "./test-support/corpus";

const partition = await replayPartition(0);

describe("the replay corpus, partition 0", () => describeReplay(partition));
