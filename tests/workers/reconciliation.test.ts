import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { reconcileTasks } from "../../src/workers/reconciliation";

describe("reconcileTasks startup sweep", () => {
  let dataSource: DataSource;

  const geoJson = JSON.stringify({
    type: "Polygon",
    coordinates: [
      [
        [-63.6, -10.3],
        [-63.6, -10.4],
        [-63.5, -10.4],
        [-63.5, -10.3],
        [-63.6, -10.3],
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
    overrides: Partial<Task> = {},
  ): Task {
    const task = new Task();
    task.clientId = "client-test";
    task.geoJson = geoJson;
    task.taskType = "polygonArea";
    task.status = status;
    task.stepNumber = stepNumber;
    task.dependency = dependency ? JSON.stringify(dependency) : null;
    task.workflow = workflow;
    Object.assign(task, overrides);
    return task;
  }

  it("is a no-op on a fresh database", async () => {
    const result = await reconcileTasks(dataSource);
    expect(result).toEqual({ reset: 0, promoted: 0 });
  });

  it("resets stranded InProgress tasks to Queued and clears progress", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);
    const stranded = makeTask(workflow, 1, TaskStatus.InProgress, null, {
      progress: "working...",
    });
    await taskRepo.save(stranded);

    const result = await reconcileTasks(dataSource);

    expect(result).toEqual({ reset: 1, promoted: 0 });
    const after = await taskRepo.findOneByOrFail({ taskId: stranded.taskId });
    expect(after.status).toBe(TaskStatus.Queued);
    expect(after.progress ?? null).toBeNull();
  });

  it("promotes a Waiting task whose single parent step is Completed", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);
    const parent = makeTask(workflow, 1, TaskStatus.Completed, null);
    const child = makeTask(workflow, 2, TaskStatus.Waiting, [1]);
    await taskRepo.save([parent, child]);

    const result = await reconcileTasks(dataSource);

    expect(result).toEqual({ reset: 0, promoted: 1 });
    const childAfter = await taskRepo.findOneByOrFail({ taskId: child.taskId });
    expect(childAfter.status).toBe(TaskStatus.Queued);
  });

  it("leaves a Waiting task with mixed Completed and Waiting parents as Waiting", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);
    const parent1 = makeTask(workflow, 1, TaskStatus.Completed, null);
    const parent2 = makeTask(workflow, 2, TaskStatus.Waiting, null);
    const child = makeTask(workflow, 3, TaskStatus.Waiting, [1, 2]);
    await taskRepo.save([parent1, parent2, child]);

    const result = await reconcileTasks(dataSource);

    expect(result.promoted).toBe(0);
    const childAfter = await taskRepo.findOneByOrFail({ taskId: child.taskId });
    expect(childAfter.status).toBe(TaskStatus.Waiting);
  });

  it("leaves a Waiting task with a Failed parent as Waiting (Failed is not Completed)", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);
    const parent = makeTask(workflow, 1, TaskStatus.Failed, null);
    const child = makeTask(workflow, 2, TaskStatus.Waiting, [1]);
    await taskRepo.save([parent, child]);

    const result = await reconcileTasks(dataSource);

    expect(result.promoted).toBe(0);
    const childAfter = await taskRepo.findOneByOrFail({ taskId: child.taskId });
    expect(childAfter.status).toBe(TaskStatus.Waiting);
  });

  it("recovers multiple stranded rows and never touches Completed or Failed tasks", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);
    const completed = makeTask(workflow, 1, TaskStatus.Completed, null, {
      output: '{"ok":true}',
    });
    const failed = makeTask(workflow, 2, TaskStatus.Failed, null, {
      error: "boom",
    });
    const stranded1 = makeTask(workflow, 3, TaskStatus.InProgress, null, {
      progress: "halfway",
    });
    const stranded2 = makeTask(workflow, 4, TaskStatus.InProgress, null, {
      progress: "nearly",
    });
    const promotable = makeTask(workflow, 5, TaskStatus.Waiting, [1]);
    await taskRepo.save([completed, failed, stranded1, stranded2, promotable]);

    const result = await reconcileTasks(dataSource);

    expect(result).toEqual({ reset: 2, promoted: 1 });
    const completedAfter = await taskRepo.findOneByOrFail({ taskId: completed.taskId });
    const failedAfter = await taskRepo.findOneByOrFail({ taskId: failed.taskId });
    expect(completedAfter.status).toBe(TaskStatus.Completed);
    expect(completedAfter.output).toBe('{"ok":true}');
    expect(failedAfter.status).toBe(TaskStatus.Failed);
    expect(failedAfter.error).toBe("boom");
    const s1 = await taskRepo.findOneByOrFail({ taskId: stranded1.taskId });
    const s2 = await taskRepo.findOneByOrFail({ taskId: stranded2.taskId });
    expect(s1.status).toBe(TaskStatus.Queued);
    expect(s1.progress ?? null).toBeNull();
    expect(s2.status).toBe(TaskStatus.Queued);
    expect(s2.progress ?? null).toBeNull();
    const promotableAfter = await taskRepo.findOneByOrFail({ taskId: promotable.taskId });
    expect(promotableAfter.status).toBe(TaskStatus.Queued);
  });
});
