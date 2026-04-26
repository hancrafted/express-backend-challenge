/**
 * Error-path coverage for TaskRunner.
 *
 * Stories pinned in this file:
 *  - story 17: malformed Task.dependency JSON must surface as a Failed task
 *              (not silently swallowed) with a useful error message.
 *  - story 18: invoking TaskRunner.run on a stale Queued task whose Workflow
 *              is already Completed (with a non-null finalResult) preserves
 *              the existing finalResult (no overwrite).
 *  - story 41: a job that throws leaves Task.output untouched (null), so
 *              downstream consumers cannot mistake a failure for success.
 */
import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Workflow } from "../../src/models/Workflow";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { makeDataSource } from "../_support/makeDataSource";
import { seedWorkflow } from "../_support/seedWorkflow";
import { makeTask } from "../_support/makeTask";

describe("TaskRunner error paths", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await makeDataSource();
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("[story 17] marks the task Failed when Task.dependency is malformed JSON", async () => {
    const workflow = await seedWorkflow(dataSource, { status: WorkflowStatus.InProgress });
    const taskRepo = dataSource.getRepository(Task);

    const task = makeTask(workflow, 1, TaskStatus.Queued);
    task.dependency = "{not-valid-json";
    await taskRepo.save(task);

    const runner = new TaskRunner(taskRepo);
    await expect(runner.run(task)).rejects.toBeDefined();

    const persisted = await taskRepo.findOneByOrFail({ taskId: task.taskId });
    expect(persisted.status).toBe(TaskStatus.Failed);
    expect(persisted.error).toBeTruthy();
    const errMsg = (persisted.error ?? "").toLowerCase();
    expect(errMsg.includes("json") || errMsg.includes("dependency")).toBe(true);
  });

  it("[story 18] does not overwrite a Workflow.finalResult that is already set", async () => {
    const sentinelFinalResult = JSON.stringify({ sentinel: "original-final-result" });
    const workflow = await seedWorkflow(dataSource, {
      status: WorkflowStatus.Completed,
      finalResult: sentinelFinalResult,
    });
    const taskRepo = dataSource.getRepository(Task);
    const workflowRepo = dataSource.getRepository(Workflow);

    const staleTask = makeTask(workflow, 1, TaskStatus.Queued);
    await taskRepo.save(staleTask);

    const runner = new TaskRunner(taskRepo);
    await runner.run(staleTask);

    const persistedWorkflow = await workflowRepo.findOneByOrFail({ workflowId: workflow.workflowId });
    expect(persistedWorkflow.finalResult).toBe(sentinelFinalResult);
    // LOCK: current behavior recomputes Workflow.status from the live task set.
    // With a single now-Completed task, status stays Completed; this test pins
    // that finalResult is preserved when already set. Re-evaluate if a future
    // task tightens "stale-task immutability" semantics.
    expect(persistedWorkflow.status).toBe(WorkflowStatus.Completed);
  });

  it("[story 41] leaves Task.output null when the underlying job throws", async () => {
    const workflow = await seedWorkflow(dataSource, { status: WorkflowStatus.InProgress });
    const taskRepo = dataSource.getRepository(Task);

    const task = makeTask(workflow, 1, TaskStatus.Queued, { geoJson: "not json" });
    await taskRepo.save(task);

    const runner = new TaskRunner(taskRepo);
    await expect(runner.run(task)).rejects.toBeDefined();

    const persisted = await taskRepo.findOneByOrFail({ taskId: task.taskId });
    expect(persisted.status).toBe(TaskStatus.Failed);
    expect(persisted.output ?? null).toBeNull();
  });
});
