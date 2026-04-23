import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { EmailNotificationJob } from "../../src/jobs/EmailNotificationJob";
import { PolygonAreaJob } from "../../src/jobs/PolygonAreaJob";

describe("TaskRunner fail-fast cascade on task failure", () => {
  let dataSource: DataSource;

  const validGeoJson = JSON.stringify({
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

  const invalidGeoJson = "this is not json";

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
    vi.restoreAllMocks();
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
    geoJson: string = validGeoJson,
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

  it("single-level: when A fails, B (deps A) is Failed with skip reason and B's job never runs", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const a = makeTask(workflow, 1, TaskStatus.Queued, null, "polygonArea", invalidGeoJson);
    const b = makeTask(workflow, 2, TaskStatus.Waiting, [1], "notification");
    await taskRepo.save([a, b]);

    const emailSpy = vi.spyOn(EmailNotificationJob.prototype, "run");

    const runner = new TaskRunner(taskRepo);
    await expect(runner.run(a)).rejects.toThrow();

    const aAfter = await taskRepo.findOneByOrFail({ taskId: a.taskId });
    const bAfter = await taskRepo.findOneByOrFail({ taskId: b.taskId });

    expect(aAfter.status).toBe(TaskStatus.Failed);
    expect(aAfter.progress).toBeNull();
    expect(aAfter.error).toBeTruthy();

    expect(bAfter.status).toBe(TaskStatus.Failed);
    expect(bAfter.progress).toBeNull();
    expect(bAfter.error).toBe("Skipped: dependency 1 failed");

    expect(emailSpy).not.toHaveBeenCalled();

    const wfRepo = dataSource.getRepository(Workflow);
    const wfAfter = await wfRepo.findOneByOrFail({ workflowId: workflow.workflowId });
    expect(wfAfter.status).toBe(WorkflowStatus.Failed);
  });

  it("multi-level: A fails cascades to B (deps A) and transitively to C (deps B); neither runs", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const a = makeTask(workflow, 1, TaskStatus.Queued, null, "polygonArea", invalidGeoJson);
    const b = makeTask(workflow, 2, TaskStatus.Waiting, [1], "notification");
    const c = makeTask(workflow, 3, TaskStatus.Waiting, [2], "notification");
    await taskRepo.save([a, b, c]);

    const emailSpy = vi.spyOn(EmailNotificationJob.prototype, "run");

    const runner = new TaskRunner(taskRepo);
    await expect(runner.run(a)).rejects.toThrow();

    const bAfter = await taskRepo.findOneByOrFail({ taskId: b.taskId });
    const cAfter = await taskRepo.findOneByOrFail({ taskId: c.taskId });

    expect(bAfter.status).toBe(TaskStatus.Failed);
    expect(bAfter.error).toBe("Skipped: dependency 1 failed");

    expect(cAfter.status).toBe(TaskStatus.Failed);
    expect(cAfter.error).toBe("Skipped: dependency 2 failed");

    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("diamond: A completes, B (deps A) fails, C (deps A) completes, D (deps B,C) is cascaded", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const a = makeTask(workflow, 1, TaskStatus.Queued, null, "polygonArea", validGeoJson);
    const b = makeTask(workflow, 2, TaskStatus.Waiting, [1], "polygonArea", invalidGeoJson);
    const c = makeTask(workflow, 3, TaskStatus.Waiting, [1], "notification");
    const d = makeTask(workflow, 4, TaskStatus.Waiting, [2, 3], "notification");
    await taskRepo.save([a, b, c, d]);

    const runner = new TaskRunner(taskRepo);

    await runner.run(a);

    const bAfterA = await taskRepo.findOneByOrFail({ taskId: b.taskId });
    const cAfterA = await taskRepo.findOneByOrFail({ taskId: c.taskId });
    expect(bAfterA.status).toBe(TaskStatus.Queued);
    expect(cAfterA.status).toBe(TaskStatus.Queued);

    const bReload = await taskRepo.findOneOrFail({ where: { taskId: b.taskId }, relations: ["workflow"] });
    await expect(runner.run(bReload)).rejects.toThrow();

    const bAfter = await taskRepo.findOneByOrFail({ taskId: b.taskId });
    const cAfter = await taskRepo.findOneByOrFail({ taskId: c.taskId });
    const dAfter = await taskRepo.findOneByOrFail({ taskId: d.taskId });

    expect(bAfter.status).toBe(TaskStatus.Failed);
    expect(cAfter.status).toBe(TaskStatus.Queued);
    expect(dAfter.status).toBe(TaskStatus.Failed);
    expect(dAfter.error).toBe("Skipped: dependency 2 failed");

    const cReload = await taskRepo.findOneOrFail({ where: { taskId: c.taskId }, relations: ["workflow"] });
    await runner.run(cReload);

    const cFinal = await taskRepo.findOneByOrFail({ taskId: c.taskId });
    const dFinal = await taskRepo.findOneByOrFail({ taskId: d.taskId });
    expect(cFinal.status).toBe(TaskStatus.Completed);
    expect(dFinal.status).toBe(TaskStatus.Failed);
    expect(dFinal.error).toBe("Skipped: dependency 2 failed");
  });

  it("transactional: cascade updates occur within a manager.transaction call", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const a = makeTask(workflow, 1, TaskStatus.Queued, null, "polygonArea", invalidGeoJson);
    const b = makeTask(workflow, 2, TaskStatus.Waiting, [1], "notification");
    await taskRepo.save([a, b]);

    const txSpy = vi.spyOn(taskRepo.manager, "transaction");

    const runner = new TaskRunner(taskRepo);
    await expect(runner.run(a)).rejects.toThrow();

    expect(txSpy).toHaveBeenCalledTimes(1);

    const bAfter = await taskRepo.findOneByOrFail({ taskId: b.taskId });
    expect(bAfter.status).toBe(TaskStatus.Failed);
    expect(bAfter.error).toBe("Skipped: dependency 1 failed");
  });
});
