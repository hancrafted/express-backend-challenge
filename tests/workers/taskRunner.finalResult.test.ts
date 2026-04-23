import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";

describe("TaskRunner writes Workflow.finalResult on terminal transition", () => {
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

  it("writes a JSON finalResult summarising all tasks when workflow completes", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const t1 = makeTask(workflow, 1, TaskStatus.Queued, null);
    const t2 = makeTask(workflow, 2, TaskStatus.Waiting, [1]);
    await taskRepo.save([t1, t2]);

    const runner = new TaskRunner(taskRepo);
    await runner.run(t1);

    const t2Reload = await taskRepo.findOneOrFail({ where: { taskId: t2.taskId }, relations: ["workflow"] });
    await runner.run(t2Reload);

    const wfRepo = dataSource.getRepository(Workflow);
    const wfAfter = await wfRepo.findOneByOrFail({ workflowId: workflow.workflowId });

    expect(wfAfter.status).toBe(WorkflowStatus.Completed);
    expect(wfAfter.finalResult).toBeTruthy();

    const parsed = JSON.parse(wfAfter.finalResult as string);
    expect(parsed.workflowId).toBe(workflow.workflowId);
    expect(parsed.status).toBe("completed");
    expect(parsed.completedTasks).toBe(2);
    expect(parsed.totalTasks).toBe(2);
    expect(parsed.tasks.map((t: any) => t.stepNumber)).toEqual([1, 2]);
    for (const task of parsed.tasks) {
      expect(task.status).toBe("completed");
      expect(task).toHaveProperty("output");
    }
  });

  it("includes failing task error and cascade-skip reasons for dependents on failed workflow", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const a = makeTask(workflow, 1, TaskStatus.Queued, null, "polygonArea", invalidGeoJson);
    const b = makeTask(workflow, 2, TaskStatus.Waiting, [1], "notification");
    const c = makeTask(workflow, 3, TaskStatus.Waiting, [2], "notification");
    await taskRepo.save([a, b, c]);

    const runner = new TaskRunner(taskRepo);
    await expect(runner.run(a)).rejects.toThrow();

    const wfRepo = dataSource.getRepository(Workflow);
    const wfAfter = await wfRepo.findOneByOrFail({ workflowId: workflow.workflowId });

    expect(wfAfter.status).toBe(WorkflowStatus.Failed);
    expect(wfAfter.finalResult).toBeTruthy();

    const parsed = JSON.parse(wfAfter.finalResult as string);
    expect(parsed.status).toBe("failed");
    expect(parsed.tasks.map((t: any) => t.stepNumber)).toEqual([1, 2, 3]);
    expect(parsed.tasks[0].error).toBeTruthy();
    expect(parsed.tasks[0].error).not.toMatch(/^Skipped:/);
    expect(parsed.tasks[1].error).toBe("Skipped: dependency 1 failed");
    expect(parsed.tasks[2].error).toBe("Skipped: dependency 2 failed");
  });

  it("orders fan-in workflow tasks by stepNumber with each output", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const p1 = makeTask(workflow, 1, TaskStatus.Queued, null);
    const p2 = makeTask(workflow, 2, TaskStatus.Queued, null);
    const child = makeTask(workflow, 3, TaskStatus.Waiting, [1, 2]);
    await taskRepo.save([p1, p2, child]);

    const runner = new TaskRunner(taskRepo);
    await runner.run(p1);
    await runner.run(p2);

    const childReload = await taskRepo.findOneOrFail({ where: { taskId: child.taskId }, relations: ["workflow"] });
    await runner.run(childReload);

    const wfRepo = dataSource.getRepository(Workflow);
    const wfAfter = await wfRepo.findOneByOrFail({ workflowId: workflow.workflowId });

    expect(wfAfter.status).toBe(WorkflowStatus.Completed);
    const parsed = JSON.parse(wfAfter.finalResult as string);
    expect(parsed.tasks.map((t: any) => t.stepNumber)).toEqual([1, 2, 3]);
    for (const task of parsed.tasks) {
      expect(task.status).toBe("completed");
      expect(task).toHaveProperty("output");
    }
  });

  it("only populates finalResult when workflow reaches a terminal state", async () => {
    const workflow = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const t1 = makeTask(workflow, 1, TaskStatus.Queued, null);
    const t2 = makeTask(workflow, 2, TaskStatus.Waiting, [1]);
    await taskRepo.save([t1, t2]);

    const runner = new TaskRunner(taskRepo);
    await runner.run(t1);

    const wfRepo = dataSource.getRepository(Workflow);
    const wfMid = await wfRepo.findOneByOrFail({ workflowId: workflow.workflowId });
    expect(wfMid.status).toBe(WorkflowStatus.InProgress);
    expect(wfMid.finalResult == null).toBe(true);
  });
});
