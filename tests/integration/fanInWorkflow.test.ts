import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import express from "express";
import request from "supertest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { WorkflowFactory, WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";
import { createWorkflowRouter } from "../../src/routes/workflowRoutes";

describe("fan-in workflow end-to-end (polygonArea + analysis -> reportGeneration)", () => {
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

  async function drainQueuedTasks(): Promise<void> {
    const taskRepository = dataSource.getRepository(Task);
    const runner = new TaskRunner(taskRepository);

    // Inlined taskWorker loop (no setTimeout) - run until no Queued tasks remain.
    // Safety bound prevents infinite loops if a bug leaves tasks queued.
    for (let i = 0; i < 50; i++) {
      const next = await taskRepository.findOne({
        where: { status: TaskStatus.Queued },
        relations: ["workflow"],
      });
      if (!next) return;
      try {
        await runner.run(next);
      } catch {
        // TaskRunner has already marked the task failed; keep draining.
      }
    }
    throw new Error("drainQueuedTasks: exceeded max iterations");
  }

  it("runs all three tasks to completion and exposes results via HTTP endpoints", async () => {
    const yamlPath = path.join(__dirname, "../../src/workflows/example_workflow.yml");
    const factory = new WorkflowFactory(dataSource);
    const workflow = await factory.createWorkflowFromYAML(yamlPath, "demo", geoJson);

    await drainQueuedTasks();

    const taskRepo = dataSource.getRepository(Task);
    const workflowRepo = dataSource.getRepository(Workflow);

    const tasks = await taskRepo.find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
    });
    expect(tasks).toHaveLength(3);
    for (const t of tasks) {
      expect(t.status).toBe(TaskStatus.Completed);
    }

    const reloaded = await workflowRepo.findOne({
      where: { workflowId: workflow.workflowId },
      relations: ["tasks"],
    });
    expect(reloaded?.status).toBe(WorkflowStatus.Completed);
    expect(reloaded?.finalResult).toBeTruthy();

    const finalResult = JSON.parse(reloaded!.finalResult!);
    expect(finalResult.workflowId).toBe(workflow.workflowId);
    expect(finalResult.status).toBe(WorkflowStatus.Completed);
    expect(finalResult.totalTasks).toBe(3);
    expect(finalResult.completedTasks).toBe(3);
    expect(Array.isArray(finalResult.tasks)).toBe(true);
    expect(finalResult.tasks).toHaveLength(3);
    expect(finalResult.tasks.map((t: any) => t.stepNumber)).toEqual([1, 2, 3]);
    expect(finalResult.tasks.map((t: any) => t.taskType)).toEqual([
      "polygonArea",
      "analysis",
      "reportGeneration",
    ]);
    for (const t of finalResult.tasks) {
      expect(t.status).toBe("completed");
      expect(t.output).toBeDefined();
    }

    const reportEntry = finalResult.tasks.find((t: any) => t.taskType === "reportGeneration");
    expect(reportEntry.output).toMatchObject({
      workflowId: workflow.workflowId,
      finalReport: expect.any(String),
    });
    expect(Array.isArray(reportEntry.output.tasks)).toBe(true);
    expect(reportEntry.output.tasks).toHaveLength(2);
    expect(reportEntry.output.tasks.map((d: any) => d.type).sort()).toEqual([
      "analysis",
      "polygonArea",
    ]);

    const app = express();
    app.use(express.json());
    app.use("/workflow", createWorkflowRouter(dataSource));

    const statusRes = await request(app).get(`/workflow/${workflow.workflowId}/status`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({
      workflowId: workflow.workflowId,
      status: WorkflowStatus.Completed,
      completedTasks: 3,
      totalTasks: 3,
    });

    const statusWithTasksRes = await request(app)
      .get(`/workflow/${workflow.workflowId}/status`)
      .query({ includeTasks: "true" });
    expect(statusWithTasksRes.status).toBe(200);
    expect(statusWithTasksRes.body.tasks.map((t: any) => t.stepNumber)).toEqual([1, 2, 3]);
    expect(statusWithTasksRes.body.tasks.map((t: any) => t.taskType)).toEqual([
      "polygonArea",
      "analysis",
      "reportGeneration",
    ]);

    const resultsRes = await request(app).get(`/workflow/${workflow.workflowId}/results`);
    expect(resultsRes.status).toBe(200);
    expect(resultsRes.body).toEqual(finalResult);
  });
});
