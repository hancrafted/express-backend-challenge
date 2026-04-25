/**
 * Unit tests for the pure `workflowSummary` projection.
 *
 * Covers:
 *   - core shape + counts (existing cases)
 *   - story 28: mid-flight workflow with all 5 task statuses present
 *   - story 34: 100-task scale workflow with mixed statuses (no truncation)
 */
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

  it("prefers task.error over task.progress for failed tasks when both are present", () => {
    const workflow = {
      workflowId: "wf-err",
      status: "failed",
      tasks: [
        {
          taskId: "t1",
          stepNumber: 1,
          taskType: "polygonArea",
          status: "failed",
          progress: "starting job...",
          error: "Invalid GeoJSON: geometry.type must be Polygon",
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

  it("falls back to task.progress for failed tasks when task.error is null/undefined", () => {
    const workflow = {
      workflowId: "wf-fb",
      status: "failed",
      tasks: [
        {
          taskId: "t1",
          stepNumber: 1,
          taskType: "polygonArea",
          status: "failed",
          progress: "legacy error string",
          error: null,
        },
      ],
    } as any;

    const result = workflowSummary(workflow, { includeTasks: true });

    expect(result.tasks?.[0]).toEqual({
      stepNumber: 1,
      taskId: "t1",
      taskType: "polygonArea",
      status: "failed",
      error: "legacy error string",
    });
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

describe("[stories 28, 34] mid-flight + scale", () => {
  it("[story 28] summarises a workflow with one task in each of the 5 statuses (mid-flight shape stable, ordered by stepNumber)", () => {
    // Insertion order intentionally scrambled to verify ordering by stepNumber.
    const workflow = {
      workflowId: "wf-mid-flight",
      status: "in_progress",
      tasks: [
        { taskId: "t-q", stepNumber: 2, taskType: "polygonArea", status: "queued" },
        { taskId: "t-c", stepNumber: 4, taskType: "polygonArea", status: "completed", output: JSON.stringify(123) },
        { taskId: "t-w", stepNumber: 1, taskType: "polygonArea", status: "waiting" },
        { taskId: "t-f", stepNumber: 5, taskType: "polygonArea", status: "failed", error: "boom" },
        { taskId: "t-p", stepNumber: 3, taskType: "polygonArea", status: "in_progress", progress: "halfway" },
      ],
    } as any;

    const result = workflowSummary(workflow, { includeTasks: true });

    // Shape stability: exact top-level keys, no extras.
    expect(Object.keys(result).sort()).toEqual(
      ["completedTasks", "status", "tasks", "totalTasks", "workflowId"],
    );
    expect(result.workflowId).toBe("wf-mid-flight");
    expect(result.status).toBe("in_progress");
    expect(result.completedTasks).toBe(1);
    expect(result.totalTasks).toBe(5);

    // tasks[] must be ordered by stepNumber regardless of input order.
    expect(result.tasks?.map(t => t.stepNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(result.tasks?.map(t => t.taskId)).toEqual(["t-w", "t-q", "t-p", "t-c", "t-f"]);
    expect(result.tasks?.map(t => t.status)).toEqual([
      "waiting",
      "queued",
      "in_progress",
      "completed",
      "failed",
    ]);
  });

  it("[story 34] summarises a 100-task workflow without truncation; completedTasks matches a manual reduce over the seed", () => {
    // Deterministic seed: ~half completed, the rest split across failed/queued/waiting/in_progress.
    const seed = Array.from({ length: 100 }, (_, i) => {
      const stepNumber = i + 1;
      const mod = i % 5;
      if (mod === 0 || mod === 1 || mod === 2) {
        // 60 completed (indexes 0,1,2,5,6,7,...)
        return {
          taskId: `t-${stepNumber}`,
          stepNumber,
          taskType: "polygonArea",
          status: "completed",
          output: JSON.stringify({ step: stepNumber }),
        };
      }
      if (mod === 3) {
        return {
          taskId: `t-${stepNumber}`,
          stepNumber,
          taskType: "polygonArea",
          status: "failed",
          error: `failure-${stepNumber}`,
        };
      }
      // mod === 4 → cycle through the three non-terminal statuses
      const cycle = ["queued", "waiting", "in_progress"][stepNumber % 3];
      return {
        taskId: `t-${stepNumber}`,
        stepNumber,
        taskType: "polygonArea",
        status: cycle,
      };
    });

    // Shuffle insertion order so the projection has to re-sort.
    const shuffled = [...seed].reverse();
    const workflow = {
      workflowId: "wf-scale-100",
      status: "in_progress",
      tasks: shuffled,
    } as any;

    const expectedCompleted = seed.reduce(
      (acc, t) => acc + (t.status === "completed" ? 1 : 0),
      0,
    );

    const result = workflowSummary(workflow, { includeTasks: true });

    expect(result.totalTasks).toBe(100);
    expect(result.completedTasks).toBe(expectedCompleted);
    expect(result.tasks).toBeDefined();
    expect(result.tasks?.length).toBe(100); // no truncation

    // tasks[] strictly ordered by stepNumber 1..100.
    const stepNumbers = result.tasks?.map(t => t.stepNumber) ?? [];
    expect(stepNumbers).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });
});

