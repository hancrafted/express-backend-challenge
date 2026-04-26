/**
 * TaskRunner lifecycle invariants — Workflow status promotion and dual-write
 * of the per-task result payload.
 *
 * Stories pinned in this file:
 *  - story 39: Workflow.status transitions Initial -> InProgress on the first
 *              successful TaskRunner.run when the workflow still has un-run
 *              dependent tasks (i.e. neither all-completed nor any-failed).
 *  - story 40: On a successful task run, both Result.data and Task.output are
 *              persisted with the same JSON-encoded job return value. This is
 *              a deliberate marker test for the Result deprecation path
 *              (per TESTING_PRD §"Further Notes") — the dual-write is the
 *              current contract; if Result is later removed, this test will
 *              fail loudly to force an explicit decision.
 *
 * All assertions read back from real persistence — no spies, no mocks.
 */
import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { makeDataSource } from "../_support/makeDataSource";
import { seedWorkflow } from "../_support/seedWorkflow";
import { makeTask } from "../_support/makeTask";

describe("TaskRunner lifecycle: workflow promotion and result dual-write", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await makeDataSource();
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("[story 39] promotes workflow.status from Initial to InProgress when the first task completes but a dependent task remains", async () => {
    const taskRepo = dataSource.getRepository(Task);
    const workflowRepo = dataSource.getRepository(Workflow);

    const workflow = await seedWorkflow(dataSource, {
      status: WorkflowStatus.Initial,
    });

    const task1 = makeTask(workflow, 1, TaskStatus.Queued);
    const task2 = makeTask(workflow, 2, TaskStatus.Waiting, {
      dependency: [1],
    });
    await taskRepo.save([task1, task2]);

    const runner = new TaskRunner(taskRepo);
    await runner.run(task1);

    const reloaded = await workflowRepo.findOneOrFail({
      where: { workflowId: workflow.workflowId },
      relations: ["tasks"],
    });
    expect(reloaded.status).toBe(WorkflowStatus.InProgress);

    const reloadedTask1 = await taskRepo.findOneByOrFail({
      taskId: task1.taskId,
    });
    expect(reloadedTask1.status).toBe(TaskStatus.Completed);

    const reloadedTask2 = await taskRepo.findOneByOrFail({
      taskId: task2.taskId,
    });
    expect(reloadedTask2.status).not.toBe(TaskStatus.Completed);
    expect(reloadedTask2.status).not.toBe(TaskStatus.Failed);
  });

  it("[story 40] writes the same JSON-encoded job result to both Result.data and Task.output on success", async () => {
    const taskRepo = dataSource.getRepository(Task);
    const resultRepo = dataSource.getRepository(Result);

    const workflow = await seedWorkflow(dataSource);

    const task = makeTask(workflow, 1, TaskStatus.Queued);
    await taskRepo.save(task);

    const runner = new TaskRunner(taskRepo);
    await runner.run(task);

    const persistedTask = await taskRepo.findOneByOrFail({ taskId: task.taskId });
    expect(persistedTask.status).toBe(TaskStatus.Completed);
    expect(persistedTask.resultId).toBeTruthy();
    expect(persistedTask.output).toBeTruthy();

    const persistedResult = await resultRepo.findOneByOrFail({
      resultId: persistedTask.resultId!,
    });
    expect(persistedResult.data).toBeTruthy();

    const outputParsed = JSON.parse(persistedTask.output as string);
    const dataParsed = JSON.parse(persistedResult.data as string);
    expect(typeof outputParsed).toBe("number");
    expect(typeof dataParsed).toBe("number");

    expect(persistedResult.data).toBe(JSON.stringify(outputParsed));
    expect(persistedTask.output).toBe(JSON.stringify(dataParsed));
    expect(persistedResult.data).toBe(persistedTask.output);
  });
});
