/** Covers TESTING_PRD stories: existing happy paths + 14. Prior art: same file. */
import { describe, it, expect } from "vitest";
import { ReportGenerationJob } from "../../src/jobs/ReportGenerationJob";
import { Task } from "../../src/models/Task";
import { Workflow } from "../../src/models/Workflow";
import { JobContext } from "../../src/jobs/Job";

function makeReportTask(workflowId: string): Task {
  const wf = new Workflow();
  wf.workflowId = workflowId;
  const t = new Task();
  t.taskId = "report-task-id";
  t.taskType = "reportGeneration";
  t.stepNumber = 99;
  t.workflow = wf;
  t.geoJson = "{}";
  return t;
}

describe("ReportGenerationJob", () => {
  it("produces Readme-#2 shape for a single dependency", async () => {
    const job = new ReportGenerationJob();
    const task = makeReportTask("wf-1");
    const context: JobContext = {
      dependencyOutputs: { 1: 12345.6 },
      dependencies: [
        { stepNumber: 1, taskId: "parent-1", taskType: "polygonArea", output: 12345.6 },
      ],
    };

    const result = await job.run(task, context);

    expect(result.workflowId).toBe("wf-1");
    expect(Array.isArray(result.tasks)).toBe(true);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toEqual({
      taskId: "parent-1",
      type: "polygonArea",
      output: 12345.6,
    });
    expect(typeof result.finalReport).toBe("string");
    expect(result.finalReport.length).toBeGreaterThan(0);
  });

  it("aggregates multiple dependencies (fan-in) into tasks[]", async () => {
    const job = new ReportGenerationJob();
    const task = makeReportTask("wf-fanin");
    const context: JobContext = {
      dependencyOutputs: { 1: 12345.6, 2: "Brazil" },
      dependencies: [
        { stepNumber: 1, taskId: "p-1", taskType: "polygonArea", output: 12345.6 },
        { stepNumber: 2, taskId: "p-2", taskType: "analysis", output: "Brazil" },
      ],
    };

    const result = await job.run(task, context);

    expect(result.workflowId).toBe("wf-fanin");
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks).toEqual([
      { taskId: "p-1", type: "polygonArea", output: 12345.6 },
      { taskId: "p-2", type: "analysis", output: "Brazil" },
    ]);
    expect(typeof result.finalReport).toBe("string");
  });

  it("surfaces a parent with null output as null in tasks[].output", async () => {
    const job = new ReportGenerationJob();
    const task = makeReportTask("wf-null");
    const context: JobContext = {
      dependencyOutputs: { 1: null },
      dependencies: [
        { stepNumber: 1, taskId: "p-null", taskType: "notification", output: null },
      ],
    };

    const result = await job.run(task, context);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toEqual({
      taskId: "p-null",
      type: "notification",
      output: null,
    });
    expect(result.tasks[0].output).toBeNull();
  });
});

describe("[story 14] misconfigured invocation", () => {
  it("[story 14] returns deterministic empty-report shape when invoked with undefined context", async () => {
    const job = new ReportGenerationJob();
    const task = makeReportTask("wf-undef-ctx");

    const result = await job.run(task, undefined);

    expect(result).toEqual({
      workflowId: "wf-undef-ctx",
      tasks: [],
      finalReport: "Aggregated 0 tasks",
    });
  });

  it("[story 14] returns deterministic empty-report shape when dependencyOutputs is empty and dependencies omitted", async () => {
    const job = new ReportGenerationJob();
    const task = makeReportTask("wf-empty-deps");
    const context: JobContext = { dependencyOutputs: {} };

    const result = await job.run(task, context);

    expect(result).toEqual({
      workflowId: "wf-empty-deps",
      tasks: [],
      finalReport: "Aggregated 0 tasks",
    });
  });
});
