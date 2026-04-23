import { describe, it, expect } from "vitest";
import { getJobForTaskType } from "../../src/jobs/JobFactory";

describe("test harness smoke test", () => {
  it("imports a source module and exposes getJobForTaskType", () => {
    expect(typeof getJobForTaskType).toBe("function");
  });
});
