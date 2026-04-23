import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";

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
