import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { Job, JobContext } from "../../src/jobs/Job";

const capturedContexts: Array<JobContext | undefined> = [];

class SpyJob implements Job {
  async run(_task: Task, context?: JobContext): Promise<string> {
    capturedContexts.push(context);
    return "spy-output";
  }
}

vi.mock("../../src/jobs/JobFactory", () => ({
  getJobForTaskType: (_taskType: string) => new SpyJob(),
}));

describe("TaskRunner builds JobContext from persisted parent outputs", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    capturedContexts.length = 0;
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
    const wf = new Workflow();
    wf.clientId = "c1";
    wf.status = WorkflowStatus.InProgress;
    return await dataSource.getRepository(Workflow).save(wf);
  }

  function makeTask(
    wf: Workflow,
    stepNumber: number,
    status: TaskStatus,
    dependency: number[] | null,
    output: string | null,
    taskType = "polygonArea",
  ): Task {
    const t = new Task();
    t.clientId = "c1";
    t.geoJson = "{}";
    t.taskType = taskType;
    t.status = status;
    t.stepNumber = stepNumber;
    t.dependency = dependency ? JSON.stringify(dependency) : null;
    t.output = output;
    t.workflow = wf;
    return t;
  }

  it("passes dependencyOutputs populated from single parent's Task.output", async () => {
    const wf = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const parent = makeTask(wf, 1, TaskStatus.Completed, null, JSON.stringify(42));
    const child = makeTask(wf, 2, TaskStatus.Queued, [1], null, "reportGeneration");
    await taskRepo.save([parent, child]);

    const runner = new TaskRunner(taskRepo);
    await runner.run(child);

    expect(capturedContexts).toHaveLength(1);
    const ctx = capturedContexts[0];
    expect(ctx).toBeDefined();
    expect(ctx!.dependencyOutputs).toEqual({ 1: 42 });
  });

  it("fan-in: puts BOTH parents in dependencyOutputs keyed by stepNumber", async () => {
    const wf = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const parent1 = makeTask(wf, 1, TaskStatus.Completed, null, JSON.stringify(100));
    const parent2 = makeTask(wf, 2, TaskStatus.Completed, null, JSON.stringify("Brazil"), "analysis");
    const child = makeTask(wf, 3, TaskStatus.Queued, [1, 2], null, "reportGeneration");
    await taskRepo.save([parent1, parent2, child]);

    const runner = new TaskRunner(taskRepo);
    await runner.run(child);

    expect(capturedContexts).toHaveLength(1);
    const ctx = capturedContexts[0]!;
    expect(ctx.dependencyOutputs).toEqual({ 1: 100, 2: "Brazil" });
    expect(ctx.dependencies).toBeDefined();
    expect(ctx.dependencies).toHaveLength(2);
    expect(ctx.dependencies!.map(d => d.stepNumber).sort()).toEqual([1, 2]);
  });

  it("task with no dependency still runs (context is undefined or has empty deps)", async () => {
    const wf = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const solo = makeTask(wf, 1, TaskStatus.Queued, null, null);
    await taskRepo.save(solo);

    const runner = new TaskRunner(taskRepo);
    await runner.run(solo);

    expect(capturedContexts).toHaveLength(1);
    const ctx = capturedContexts[0];
    if (ctx !== undefined) {
      expect(Object.keys(ctx.dependencyOutputs)).toHaveLength(0);
      expect(ctx.dependencies ?? []).toHaveLength(0);
    }

    const persisted = await taskRepo.findOneByOrFail({ taskId: solo.taskId });
    expect(persisted.status).toBe(TaskStatus.Completed);
  });

  it("parent with output=null surfaces in dependencyOutputs with value null (key present)", async () => {
    const wf = await seedWorkflow();
    const taskRepo = dataSource.getRepository(Task);

    const parent = makeTask(wf, 1, TaskStatus.Completed, null, null, "notification");
    const child = makeTask(wf, 2, TaskStatus.Queued, [1], null, "reportGeneration");
    await taskRepo.save([parent, child]);

    const runner = new TaskRunner(taskRepo);
    await runner.run(child);

    expect(capturedContexts).toHaveLength(1);
    const ctx = capturedContexts[0]!;
    expect(Object.prototype.hasOwnProperty.call(ctx.dependencyOutputs, 1)).toBe(true);
    expect(ctx.dependencyOutputs[1]).toBeNull();
    expect(ctx.dependencies).toBeDefined();
    expect(ctx.dependencies).toHaveLength(1);
    expect(ctx.dependencies![0].output).toBeNull();
  });
});
