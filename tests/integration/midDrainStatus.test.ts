/**
 * Story 37 — mid-drain status polling shows monotonic InProgress shape via HTTP.
 *
 * Drives the example fan-in workflow (polygonArea + analysis ->
 * reportGeneration[deps:1,2]) and polls GET /workflow/:id/status at three
 * points across the drain to lock in the workflow-status state machine and
 * the `completedTasks`/`totalTasks` counters surfaced by `workflowSummary`.
 *
 * Three-snapshot pattern:
 *   1. BEFORE any task runs:  status="initial",     completedTasks=0, totalTasks=3
 *   2. AFTER one task runs:   status="in_progress", completedTasks=1, totalTasks=3
 *   3. AFTER full drain:      status="completed",   completedTasks=3, totalTasks=3
 *
 * Monotonicity: completedTasks strictly increases between snapshots 1->2 and
 * is non-decreasing between snapshots 2->3; totalTasks is identical across
 * all three snapshots.
 *
 * Snapshot 2 is taken after running exactly ONE task. `drainQueuedTasks` does
 * not support an iteration cap that returns cleanly (passing maxIterations=1
 * would throw), so the single-step drain is inlined here.
 */
import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import express from "express";
import request from "supertest";
import { DataSource } from "typeorm";
// Side-effect imports: ensure entity classes register their decorators (and
// the WorkflowStatus enum becomes defined) before WorkflowFactory.ts runs.
import "../../src/models/Task";
import "../../src/models/Result";
import "../../src/models/Workflow";
import { Task } from "../../src/models/Task";
import { WorkflowFactory, WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";
import { createWorkflowRouter } from "../../src/routes/workflowRoutes";
import { makeDataSource } from "../_support/makeDataSource";
import { drainQueuedTasks } from "../_support/drainQueuedTasks";

describe("mid-drain status polling end-to-end (fan-in workflow)", () => {
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
    dataSource = await makeDataSource();
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("[story 37] mid-drain status polling shows monotonic InProgress shape", async () => {
    const yamlPath = path.join(__dirname, "../../src/workflows/example_workflow.yml");
    const factory = new WorkflowFactory(dataSource);
    const workflow = await factory.createWorkflowFromYAML(yamlPath, "demo", geoJson);

    const app = express();
    app.use(express.json());
    app.use("/workflow", createWorkflowRouter(dataSource));

    // Snapshot 1: before any task runs. WorkflowFactory seeds status="initial".
    const snap1 = await request(app).get(`/workflow/${workflow.workflowId}/status`);
    expect(snap1.status).toBe(200);
    expect(snap1.body).toMatchObject({
      workflowId: workflow.workflowId,
      status: WorkflowStatus.Initial,
      completedTasks: 0,
      totalTasks: 3,
    });

    // Inlined single-step drain: run exactly one Queued task. (Using
    // `drainQueuedTasks(dataSource, 1)` would throw "exceeded max iterations"
    // because the helper's loop bound is checked before re-querying for
    // remaining work.)
    const taskRepo = dataSource.getRepository(Task);
    const runner = new TaskRunner(taskRepo);
    const firstQueued = await taskRepo.findOne({
      where: { status: TaskStatus.Queued },
      relations: ["workflow"],
    });
    expect(firstQueued).not.toBeNull();
    await runner.run(firstQueued!);

    // Snapshot 2: one task complete, workflow transitioned to in_progress.
    const snap2 = await request(app).get(`/workflow/${workflow.workflowId}/status`);
    expect(snap2.status).toBe(200);
    expect(snap2.body).toMatchObject({
      workflowId: workflow.workflowId,
      status: WorkflowStatus.InProgress,
      completedTasks: 1,
      totalTasks: 3,
    });

    // Drain the rest.
    await drainQueuedTasks(dataSource);

    // Snapshot 3: all tasks complete, workflow terminal.
    const snap3 = await request(app).get(`/workflow/${workflow.workflowId}/status`);
    expect(snap3.status).toBe(200);
    expect(snap3.body).toMatchObject({
      workflowId: workflow.workflowId,
      status: WorkflowStatus.Completed,
      completedTasks: 3,
      totalTasks: 3,
    });

    // Monotonicity: completedTasks strictly increases 1->2, non-decreasing
    // 2->3; totalTasks identical across all three snapshots.
    expect(snap2.body.completedTasks).toBeGreaterThan(snap1.body.completedTasks);
    expect(snap3.body.completedTasks).toBeGreaterThanOrEqual(snap2.body.completedTasks);
    expect(snap1.body.totalTasks).toBe(snap2.body.totalTasks);
    expect(snap2.body.totalTasks).toBe(snap3.body.totalTasks);
  });
});
