import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { TaskStatus } from "../../src/workers/taskRunner";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { createWorkflowRouter } from "../../src/routes/workflowRoutes";

describe("GET /workflow/:id/status and /workflow/:id/results", () => {
  let dataSource: DataSource;
  let app: express.Express;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: "sqlite",
      database: ":memory:",
      dropSchema: true,
      synchronize: true,
      entities: [Task, Result, Workflow],
    });
    await dataSource.initialize();

    app = express();
    app.use(express.json());
    app.use("/workflow", createWorkflowRouter(dataSource));
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  async function seedWorkflow(status: WorkflowStatus = WorkflowStatus.Initial): Promise<Workflow> {
    const workflowRepo = dataSource.getRepository(Workflow);
    const workflow = new Workflow();
    workflow.clientId = "client-test";
    workflow.status = status;
    return await workflowRepo.save(workflow);
  }

  function makeTask(
    workflow: Workflow,
    stepNumber: number,
    status: TaskStatus,
    overrides: Partial<Task> = {},
  ): Task {
    const task = new Task();
    task.clientId = "client-test";
    task.geoJson = "{}";
    task.taskType = "polygonArea";
    task.status = status;
    task.stepNumber = stepNumber;
    task.dependency = null;
    task.workflow = workflow;
    Object.assign(task, overrides);
    return task;
  }

  describe("GET /workflow/:id/status", () => {
    it("returns 200 with workflow summary (no tasks[] by default)", async () => {
      const workflow = await seedWorkflow(WorkflowStatus.InProgress);
      const taskRepo = dataSource.getRepository(Task);
      await taskRepo.save([
        makeTask(workflow, 1, TaskStatus.Completed, { output: JSON.stringify({ area: 1 }) }),
        makeTask(workflow, 2, TaskStatus.Queued),
      ]);

      const res = await request(app).get(`/workflow/${workflow.workflowId}/status`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        workflowId: workflow.workflowId,
        status: WorkflowStatus.InProgress,
        completedTasks: 1,
        totalTasks: 2,
      });
      expect(res.body.tasks).toBeUndefined();
    });

    it("returns 200 with tasks[] ordered by stepNumber when ?includeTasks=true", async () => {
      const workflow = await seedWorkflow(WorkflowStatus.InProgress);
      const taskRepo = dataSource.getRepository(Task);
      await taskRepo.save([
        makeTask(workflow, 2, TaskStatus.Queued),
        makeTask(workflow, 1, TaskStatus.Completed, { output: JSON.stringify({ area: 1 }) }),
        makeTask(workflow, 3, TaskStatus.Waiting),
      ]);

      const res = await request(app)
        .get(`/workflow/${workflow.workflowId}/status`)
        .query({ includeTasks: "true" });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.tasks)).toBe(true);
      expect(res.body.tasks.map((t: any) => t.stepNumber)).toEqual([1, 2, 3]);
    });

    it("returns 404 for unknown workflow id", async () => {
      const res = await request(app).get(`/workflow/unknownid/status`);
      expect(res.status).toBe(404);
    });

    it("does not count failed tasks as completed", async () => {
      const workflow = await seedWorkflow(WorkflowStatus.InProgress);
      const taskRepo = dataSource.getRepository(Task);
      await taskRepo.save([
        makeTask(workflow, 1, TaskStatus.Completed, { output: JSON.stringify({ area: 1 }) }),
        makeTask(workflow, 2, TaskStatus.Failed, { error: "boom" }),
        makeTask(workflow, 3, TaskStatus.Queued),
      ]);

      const res = await request(app).get(`/workflow/${workflow.workflowId}/status`);

      expect(res.status).toBe(200);
      expect(res.body.completedTasks).toBe(1);
      expect(res.body.totalTasks).toBe(3);
    });
  });

  describe("GET /workflow/:id/results", () => {
    it("returns 200 with parsed finalResult for a completed workflow", async () => {
      const finalResult = {
        workflowId: "wfid",
        status: "completed",
        completedTasks: 2,
        totalTasks: 2,
        tasks: [
          { stepNumber: 1, taskId: "t1", taskType: "polygonArea", status: "completed", output: { area: 1 } },
          { stepNumber: 2, taskId: "t2", taskType: "polygonArea", status: "completed", output: { area: 2 } },
        ],
      };
      const workflow = await seedWorkflow(WorkflowStatus.Completed);
      workflow.finalResult = JSON.stringify(finalResult);
      await dataSource.getRepository(Workflow).save(workflow);

      const res = await request(app).get(`/workflow/${workflow.workflowId}/results`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(finalResult);
    });

    it("returns 200 for a failed workflow (terminal includes failed)", async () => {
      const finalResult = {
        workflowId: "wfid",
        status: "failed",
        completedTasks: 0,
        totalTasks: 1,
        tasks: [
          { stepNumber: 1, taskId: "t1", taskType: "polygonArea", status: "failed", error: "boom" },
        ],
      };
      const workflow = await seedWorkflow(WorkflowStatus.Failed);
      workflow.finalResult = JSON.stringify(finalResult);
      await dataSource.getRepository(Workflow).save(workflow);

      const res = await request(app).get(`/workflow/${workflow.workflowId}/results`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(finalResult);
    });

    it("returns 400 for an in_progress workflow", async () => {
      const workflow = await seedWorkflow(WorkflowStatus.InProgress);
      const res = await request(app).get(`/workflow/${workflow.workflowId}/results`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 for an initial workflow", async () => {
      const workflow = await seedWorkflow(WorkflowStatus.Initial);
      const res = await request(app).get(`/workflow/${workflow.workflowId}/results`);
      expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown workflow id", async () => {
      const res = await request(app).get(`/workflow/unknownid/results`);
      expect(res.status).toBe(404);
    });
  });
});
