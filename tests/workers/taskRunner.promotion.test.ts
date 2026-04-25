/**
 * Promotion coverage for TaskRunner.
 *
 * Stories pinned in this file:
 *  - existing: Waiting → Queued promotion when single/multi-parent
 *              dependencies complete, all within one manager.transaction.
 *  - story 22: a 4-deep transitive dependency chain (A→B→C→D) is promoted
 *              one level per TaskRunner.run call; intermediate steps stay
 *              Waiting until their direct parent completes.
 */
import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { makeDataSource } from "../_support/makeDataSource";
import { seedWorkflow as seedWorkflowSupport } from "../_support/seedWorkflow";
import { makeTask as makeTaskSupport } from "../_support/makeTask";

describe("TaskRunner promotes Waiting children when dependencies complete", () => {
  let dataSource: DataSource;

  const geoJson = JSON.stringify({
    type: "Polygon",
    coordinates: [
      [
        [-63.624885020050996, -10.311050368263523],
        [-63.624885020050996, -10.367865108370523],
        [-63.61278302732815, -10.367865108370523],
        [-63.61278302732815, -10.311050368263523],
        [-63.624885020050996, -10.311050368263523],
      ],
    ],
  });

  beforeEach(async () => {
    dataSource = new DataSource({
      type: "sqlite",
      database: ":memory:",
      dropSchema: true,
      synchronize: true,
      entities: [Task, Result, Workflow],
    });
    await dataSource.initialize();
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  async function seedWorkflow(): Promise<Workflow> {
    const workflowRepo = dataSource.getRepository(Workflow);
    const workflow = new Workflow();
    workflow.clientId = "client-test";
    workflow.status = WorkflowStatus.Initial;
    return await workflowRepo.save(workflow);
  }

  function makeTask(
    workflow: Workflow,
    stepNumber: number,
    status: TaskStatus,
    dependency: number[] | null,
    taskType = "polygonArea",
  ): Task {
    const task = new Task();
    task.clientId = "client-test";
    task.geoJson = geoJson;
    task.taskType = taskType;
    task.status = status;
    task.stepNumber = stepNumber;
    task.dependency = dependency ? JSON.stringify(dependency) : null;
    task.workflow = workflow;
    return task;
  }

  it("promotes a Waiting child whose single parent just completed to Queued", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const parent = makeTask(workflow, 1, TaskStatus.Queued, null);
    const child = makeTask(workflow, 2, TaskStatus.Waiting, [1], "notification");
    await taskRepo.save([parent, child]);

    const runner = new TaskRunner(taskRepo);
    await runner.run(parent);

    const parentAfter = await taskRepo.findOneByOrFail({ taskId: parent.taskId });
    const childAfter = await taskRepo.findOneByOrFail({ taskId: child.taskId });

    expect(parentAfter.status).toBe(TaskStatus.Completed);
    expect(childAfter.status).toBe(TaskStatus.Queued);
  });

  it("keeps a Waiting child with multiple parents Waiting until ALL parents are completed", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const parent1 = makeTask(workflow, 1, TaskStatus.Queued, null);
    const parent2 = makeTask(workflow, 2, TaskStatus.Queued, null);
    const child = makeTask(workflow, 3, TaskStatus.Waiting, [1, 2], "notification");
    await taskRepo.save([parent1, parent2, child]);

    const runner = new TaskRunner(taskRepo);
    await runner.run(parent1);

    let childAfter = await taskRepo.findOneByOrFail({ taskId: child.taskId });
    expect(childAfter.status).toBe(TaskStatus.Waiting);

    await runner.run(parent2);

    childAfter = await taskRepo.findOneByOrFail({ taskId: child.taskId });
    expect(childAfter.status).toBe(TaskStatus.Queued);
  });

  it("performs parent completion and child promotion within a single manager.transaction call", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const parent = makeTask(workflow, 1, TaskStatus.Queued, null);
    const child = makeTask(workflow, 2, TaskStatus.Waiting, [1], "notification");
    await taskRepo.save([parent, child]);

    const txSpy = vi.spyOn(taskRepo.manager, "transaction");

    const runner = new TaskRunner(taskRepo);
    await runner.run(parent);

    expect(txSpy).toHaveBeenCalledTimes(1);

    const parentAfter = await taskRepo.findOneByOrFail({ taskId: parent.taskId });
    const childAfter = await taskRepo.findOneByOrFail({ taskId: child.taskId });
    expect(parentAfter.status).toBe(TaskStatus.Completed);
    expect(childAfter.status).toBe(TaskStatus.Queued);
  });
});

describe("[story 22] transitive chain promotion", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await makeDataSource();
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("[story 22] promotes a 4-deep dependency chain one level per TaskRunner.run call", async () => {
    const workflow = await seedWorkflowSupport(dataSource);
    const taskRepo = dataSource.getRepository(Task);

    const a = makeTaskSupport(workflow, 1, TaskStatus.Queued, { dependency: null });
    const b = makeTaskSupport(workflow, 2, TaskStatus.Waiting, { dependency: [1] });
    const c = makeTaskSupport(workflow, 3, TaskStatus.Waiting, { dependency: [2] });
    const d = makeTaskSupport(workflow, 4, TaskStatus.Waiting, { dependency: [3] });
    await taskRepo.save([a, b, c, d]);

    const runner = new TaskRunner(taskRepo);

    await runner.run(a);

    let aAfter = await taskRepo.findOneByOrFail({ taskId: a.taskId });
    let bAfter = await taskRepo.findOneByOrFail({ taskId: b.taskId });
    let cAfter = await taskRepo.findOneByOrFail({ taskId: c.taskId });
    let dAfter = await taskRepo.findOneByOrFail({ taskId: d.taskId });
    expect(aAfter.status).toBe(TaskStatus.Completed);
    expect(bAfter.status).toBe(TaskStatus.Queued);
    expect(cAfter.status).toBe(TaskStatus.Waiting);
    expect(dAfter.status).toBe(TaskStatus.Waiting);

    const bReload = await taskRepo.findOneOrFail({ where: { taskId: b.taskId }, relations: ["workflow"] });
    await runner.run(bReload);

    bAfter = await taskRepo.findOneByOrFail({ taskId: b.taskId });
    cAfter = await taskRepo.findOneByOrFail({ taskId: c.taskId });
    dAfter = await taskRepo.findOneByOrFail({ taskId: d.taskId });
    expect(bAfter.status).toBe(TaskStatus.Completed);
    expect(cAfter.status).toBe(TaskStatus.Queued);
    expect(dAfter.status).toBe(TaskStatus.Waiting);

    const cReload = await taskRepo.findOneOrFail({ where: { taskId: c.taskId }, relations: ["workflow"] });
    await runner.run(cReload);

    cAfter = await taskRepo.findOneByOrFail({ taskId: c.taskId });
    dAfter = await taskRepo.findOneByOrFail({ taskId: d.taskId });
    expect(cAfter.status).toBe(TaskStatus.Completed);
    expect(dAfter.status).toBe(TaskStatus.Queued);

    const dReload = await taskRepo.findOneOrFail({ where: { taskId: d.taskId }, relations: ["workflow"] });
    await runner.run(dReload);

    dAfter = await taskRepo.findOneByOrFail({ taskId: d.taskId });
    expect(dAfter.status).toBe(TaskStatus.Completed);
  });
});
