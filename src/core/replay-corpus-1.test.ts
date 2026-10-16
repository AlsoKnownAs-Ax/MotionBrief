import { describe } from "vitest";
import { describeReplay, replayPartition } from "./test-support/corpus";

const partition = await replayPartition(1);

describe("the replay corpus, partition 1", () => describeReplay(partition));
