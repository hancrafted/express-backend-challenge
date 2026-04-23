import { describe, it, expect } from "vitest";
import { getJobForTaskType } from "../../src/jobs/JobFactory";
import { ReportGenerationJob } from "../../src/jobs/ReportGenerationJob";

describe("test harness smoke test", () => {
  it("imports a source module and exposes getJobForTaskType", () => {
    expect(typeof getJobForTaskType).toBe("function");
  });

  it("maps 'reportGeneration' to ReportGenerationJob", () => {
    const job = getJobForTaskType("reportGeneration");
    expect(job).toBeInstanceOf(ReportGenerationJob);
  });
});
