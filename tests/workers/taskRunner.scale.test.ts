/**
 * TaskRunner-at-scale graph-shape coverage.
 *
 * Stories pinned in this file:
 *  - story 31: 100-task fan-in completes — 99 analysis leaves + 1
 *              reportGeneration aggregator (deps [1..99]); after a full
 *              drain every task is Completed and the workflow is
 *              Completed with finalResult populated.
 *  - story 32: 100-task fan-in with one failed leaf — same shape as
 *              story 31, but leaf step 50 is a polygonArea task with
 *              invalid GeoJSON. The aggregator (step 100) is cascaded
 *              to Failed with `Skipped: dependency 50 failed`, and the
 *              workflow.finalResult.tasks array contains all 100
 *              entries ordered by stepNumber.
 *  - story 33: 50-deep linear chain completes — 50 analysis tasks where
 *              each step N depends on step N-1; after a full drain
 *              every step is Completed (no Waiting/Queued/InProgress
 *              residue).
 */
import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Workflow } from "../../src/models/Workflow";
import { TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { makeDataSource } from "../_support/makeDataSource";
import { seedWorkflow } from "../_support/seedWorkflow";
import { makeTask } from "../_support/makeTask";
import { drainQueuedTasks } from "../_support/drainQueuedTasks";

describe("TaskRunner at scale (fan-in & deep chain graph shapes)", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await makeDataSource();
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("[story 31] 100-task fan-in (99 analysis leaves + 1 reportGeneration) completes with all tasks Completed", async () => {
    const workflow = await seedWorkflow(dataSource);
    const taskRepo = dataSource.getRepository(Task);

    const tasks: Task[] = [];
    for (let step = 1; step <= 99; step++) {
      tasks.push(makeTask(workflow, step, TaskStatus.Queued, { taskType: "analysis" }));
    }
    const leafSteps = Array.from({ length: 99 }, (_, i) => i + 1);
    tasks.push(makeTask(workflow, 100, TaskStatus.Waiting, {
      taskType: "reportGeneration",
      dependency: leafSteps,
    }));
    await taskRepo.save(tasks);

    await drainQueuedTasks(dataSource);

    const allAfter = await taskRepo.find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
    });
    expect(allAfter).toHaveLength(100);
    for (const t of allAfter) {
      expect(t.status).toBe(TaskStatus.Completed);
    }

    const wfRepo = dataSource.getRepository(Workflow);
    const wfAfter = await wfRepo.findOneByOrFail({ workflowId: workflow.workflowId });
    expect(wfAfter.status).toBe(WorkflowStatus.Completed);
    expect(wfAfter.finalResult).toBeTruthy();
    const parsed = JSON.parse(wfAfter.finalResult as string);
    expect(parsed.totalTasks).toBe(100);
    expect(parsed.completedTasks).toBe(100);
  });

  it("[story 32] 100-task fan-in with leaf step 50 failing cascades the aggregator and writes a 100-entry finalResult", async () => {
    const workflow = await seedWorkflow(dataSource);
    const taskRepo = dataSource.getRepository(Task);

    const failingStep = 50;
    const tasks: Task[] = [];
    for (let step = 1; step <= 99; step++) {
      if (step === failingStep) {
        tasks.push(makeTask(workflow, step, TaskStatus.Queued, {
          taskType: "polygonArea",
          geoJson: "this is not json",
        }));
      } else {
        tasks.push(makeTask(workflow, step, TaskStatus.Queued, { taskType: "analysis" }));
      }
    }
    const leafSteps = Array.from({ length: 99 }, (_, i) => i + 1);
    tasks.push(makeTask(workflow, 100, TaskStatus.Waiting, {
      taskType: "reportGeneration",
      dependency: leafSteps,
    }));
    await taskRepo.save(tasks);

    await drainQueuedTasks(dataSource);

    const failingLeaf = await taskRepo.findOneByOrFail({ taskId: tasks[failingStep - 1].taskId });
    expect(failingLeaf.status).toBe(TaskStatus.Failed);
    expect(failingLeaf.error).toBeTruthy();

    const aggregator = await taskRepo.findOneByOrFail({ taskId: tasks[99].taskId });
    expect(aggregator.stepNumber).toBe(100);
    expect(aggregator.status).toBe(TaskStatus.Failed);
    expect(aggregator.error).toBe(`Skipped: dependency ${failingStep} failed`);

    const wfRepo = dataSource.getRepository(Workflow);
    const wfAfter = await wfRepo.findOneByOrFail({ workflowId: workflow.workflowId });
    expect(wfAfter.status).toBe(WorkflowStatus.Failed);
    expect(wfAfter.finalResult).toBeTruthy();
    const parsed = JSON.parse(wfAfter.finalResult as string);
    expect(parsed.tasks).toHaveLength(100);
    expect(parsed.tasks.map((t: any) => t.stepNumber)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
  });

  it("[story 33] 50-deep linear analysis chain completes with every step Completed", async () => {
    const workflow = await seedWorkflow(dataSource);
    const taskRepo = dataSource.getRepository(Task);

    const tasks: Task[] = [];
    tasks.push(makeTask(workflow, 1, TaskStatus.Queued, { taskType: "analysis" }));
    for (let step = 2; step <= 50; step++) {
      tasks.push(makeTask(workflow, step, TaskStatus.Waiting, {
        taskType: "analysis",
        dependency: [step - 1],
      }));
    }
    await taskRepo.save(tasks);

    await drainQueuedTasks(dataSource);

    const allAfter = await taskRepo.find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
      order: { stepNumber: "ASC" },
    });
    expect(allAfter).toHaveLength(50);
    for (const t of allAfter) {
      expect(t.status).toBe(TaskStatus.Completed);
    }
    expect(allAfter[0].status).toBe(TaskStatus.Completed);
    expect(allAfter[49].status).toBe(TaskStatus.Completed);
  });
});
