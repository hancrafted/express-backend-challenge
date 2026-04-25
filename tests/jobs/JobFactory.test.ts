/** Covers TESTING_PRD stories: existing harness smoke test + 15. Prior art: same file. */
import { describe, it, expect } from "vitest";
import { getJobForTaskType } from "../../src/jobs/JobFactory";
import { DataAnalysisJob } from "../../src/jobs/DataAnalysisJob";
import { EmailNotificationJob } from "../../src/jobs/EmailNotificationJob";
import { PolygonAreaJob } from "../../src/jobs/PolygonAreaJob";
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

describe("[story 15] taskType resolution", () => {
  it("[story 15] maps 'polygonArea' to PolygonAreaJob", () => {
    expect(getJobForTaskType("polygonArea")).toBeInstanceOf(PolygonAreaJob);
  });

  it("[story 15] maps 'analysis' to DataAnalysisJob", () => {
    expect(getJobForTaskType("analysis")).toBeInstanceOf(DataAnalysisJob);
  });

  it("[story 15] maps 'reportGeneration' to ReportGenerationJob", () => {
    expect(getJobForTaskType("reportGeneration")).toBeInstanceOf(ReportGenerationJob);
  });

  it("[story 15] maps 'notification' to EmailNotificationJob", () => {
    expect(getJobForTaskType("notification")).toBeInstanceOf(EmailNotificationJob);
  });

  it("[story 15] throws an Error whose message contains the unknown taskType", () => {
    const unknown = "definitelyNotARealTaskType";
    expect(() => getJobForTaskType(unknown)).toThrow(unknown);
  });
});
