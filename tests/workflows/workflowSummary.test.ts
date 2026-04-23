import { describe, it, expect } from "vitest";
import { workflowSummary } from "../../src/workflows/workflowSummary";

describe("workflowSummary", () => {
  it("returns workflowId, status, and zero counts for an empty workflow", () => {
    const workflow = {
      workflowId: "wf-1",
      status: "initial",
      tasks: [],
    } as any;

    expect(workflowSummary(workflow, { includeTasks: false })).toEqual({
      workflowId: "wf-1",
      status: "initial",
      completedTasks: 0,
      totalTasks: 0,
    });
  });

  it("counts totalTasks as the number of tasks in the workflow", () => {
    const workflow = {
      workflowId: "wf-2",
      status: "in_progress",
      tasks: [
        { taskId: "t1", stepNumber: 1, taskType: "a", status: "queued" },
        { taskId: "t2", stepNumber: 2, taskType: "b", status: "queued" },
        { taskId: "t3", stepNumber: 3, taskType: "c", status: "queued" },
      ],
    } as any;

    const result = workflowSummary(workflow, { includeTasks: false });

    expect(result.totalTasks).toBe(3);
  });

  it("counts only completed-status tasks in completedTasks (failed tasks are excluded)", () => {
    const workflow = {
      workflowId: "wf-3",
      status: "failed",
      tasks: [
        { taskId: "t1", stepNumber: 1, taskType: "a", status: "completed", output: "null" },
        { taskId: "t2", stepNumber: 2, taskType: "b", status: "failed", progress: "boom" },
        { taskId: "t3", stepNumber: 3, taskType: "c", status: "completed", output: "null" },
        { taskId: "t4", stepNumber: 4, taskType: "d", status: "queued" },
      ],
    } as any;

    const result = workflowSummary(workflow, { includeTasks: false });

    expect(result.completedTasks).toBe(2);
    expect(result.totalTasks).toBe(4);
  });

  it("includes tasks[] with completed shape and parsed JSON output when includeTasks is true", () => {
    const workflow = {
      workflowId: "wf-4",
      status: "completed",
      tasks: [
        {
          taskId: "t1",
          stepNumber: 1,
          taskType: "polygonArea",
          status: "completed",
          output: JSON.stringify(42),
        },
      ],
    } as any;

    const result = workflowSummary(workflow, { includeTasks: true });

    expect(result.tasks).toEqual([
      {
        stepNumber: 1,
        taskId: "t1",
        taskType: "polygonArea",
        status: "completed",
        output: 42,
      },
    ]);
  });

  it("orders tasks[] by stepNumber ascending regardless of input order", () => {
    const workflow = {
      workflowId: "wf-5",
      status: "completed",
      tasks: [
        { taskId: "t3", stepNumber: 3, taskType: "c", status: "completed", output: JSON.stringify("c-out") },
        { taskId: "t1", stepNumber: 1, taskType: "a", status: "completed", output: JSON.stringify("a-out") },
        { taskId: "t2", stepNumber: 2, taskType: "b", status: "completed", output: JSON.stringify("b-out") },
      ],
    } as any;

    const result = workflowSummary(workflow, { includeTasks: true });

    expect(result.tasks?.map(t => t.stepNumber)).toEqual([1, 2, 3]);
    expect(result.tasks?.map(t => t.taskId)).toEqual(["t1", "t2", "t3"]);
  });

  it("represents failed tasks with status 'failed' and the error message from progress", () => {
    const workflow = {
      workflowId: "wf-6",
      status: "failed",
      tasks: [
        {
          taskId: "t1",
          stepNumber: 1,
          taskType: "polygonArea",
          status: "failed",
          progress: "Invalid GeoJSON: geometry.type must be Polygon",
        },
      ],
    } as any;

    const result = workflowSummary(workflow, { includeTasks: true });

    expect(result.tasks).toEqual([
      {
        stepNumber: 1,
        taskId: "t1",
        taskType: "polygonArea",
        status: "failed",
        error: "Invalid GeoJSON: geometry.type must be Polygon",
      },
    ]);
  });

  it("surfaces fail-fast cascade-skipped tasks with their 'Skipped: ...' error string", () => {
    const workflow = {
      workflowId: "wf-7",
      status: "failed",
      tasks: [
        {
          taskId: "t1",
          stepNumber: 1,
          taskType: "polygonArea",
          status: "failed",
          progress: "boom",
        },
        {
          taskId: "t2",
          stepNumber: 2,
          taskType: "reportGeneration",
          status: "failed",
          progress: "Skipped: dependency 1 failed",
        },
      ],
    } as any;

    const result = workflowSummary(workflow, { includeTasks: true });

    expect(result.tasks).toEqual([
      {
        stepNumber: 1,
        taskId: "t1",
        taskType: "polygonArea",
        status: "failed",
        error: "boom",
      },
      {
        stepNumber: 2,
        taskId: "t2",
        taskType: "reportGeneration",
        status: "failed",
        error: "Skipped: dependency 1 failed",
      },
    ]);
    expect(result.completedTasks).toBe(0);
    expect(result.totalTasks).toBe(2);
  });

  it("represents non-terminal tasks with their status and includes progress only when present", () => {
    const workflow = {
      workflowId: "wf-8",
      status: "in_progress",
      tasks: [
        { taskId: "t1", stepNumber: 1, taskType: "a", status: "waiting", progress: null },
        { taskId: "t2", stepNumber: 2, taskType: "b", status: "queued" },
        { taskId: "t3", stepNumber: 3, taskType: "c", status: "in_progress", progress: "halfway" },
      ],
    } as any;

    const result = workflowSummary(workflow, { includeTasks: true });

    expect(result.tasks).toEqual([
      { stepNumber: 1, taskId: "t1", taskType: "a", status: "waiting" },
      { stepNumber: 2, taskId: "t2", taskType: "b", status: "queued" },
      { stepNumber: 3, taskId: "t3", taskType: "c", status: "in_progress", progress: "halfway" },
    ]);
  });

  it("round-trips structured JSON outputs back into parsed values", () => {
    const nested = { area: 1234.5, units: "m^2", meta: { iso: true } };
    const workflow = {
      workflowId: "wf-9",
      status: "completed",
      tasks: [
        {
          taskId: "t1",
          stepNumber: 1,
          taskType: "polygonArea",
          status: "completed",
          output: JSON.stringify(nested),
        },
      ],
    } as any;

    const result = workflowSummary(workflow, { includeTasks: true });

    expect(result.tasks?.[0]).toEqual({
      stepNumber: 1,
      taskId: "t1",
      taskType: "polygonArea",
      status: "completed",
      output: nested,
    });
  });
});
