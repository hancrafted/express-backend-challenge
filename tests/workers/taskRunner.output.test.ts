import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";

describe("TaskRunner persists task.output on successful polygonArea run", () => {
  let dataSource: DataSource;

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

  it("writes a stringified JSON number to task.output after polygonArea success", async () => {
    const workflowRepo = dataSource.getRepository(Workflow);
    const taskRepo = dataSource.getRepository(Task);

    const workflow = new Workflow();
    workflow.clientId = "client-test";
    workflow.status = WorkflowStatus.Initial;
    await workflowRepo.save(workflow);

    const task = new Task();
    task.clientId = "client-test";
    task.taskType = "polygonArea";
    task.status = TaskStatus.Queued;
    task.stepNumber = 1;
    task.workflow = workflow;
    task.geoJson = JSON.stringify({
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
    await taskRepo.save(task);

    const runner = new TaskRunner(taskRepo);
    await runner.run(task);

    const persisted = await taskRepo.findOneByOrFail({ taskId: task.taskId });

    expect(persisted.status).toBe(TaskStatus.Completed);
    expect(persisted.output).toBeTruthy();
    const parsed = JSON.parse(persisted.output as string);
    expect(typeof parsed).toBe("number");
    expect(parsed).toBeGreaterThan(8_000_000);
    expect(parsed).toBeLessThan(9_000_000);
  });
});
