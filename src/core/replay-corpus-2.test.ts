import { describe } from "vitest";
import { describeReplay, replayPartition } from "./test-support/corpus";

const partition = await replayPartition(2);

describe("the replay corpus, partition 2", () => describeReplay(partition));
