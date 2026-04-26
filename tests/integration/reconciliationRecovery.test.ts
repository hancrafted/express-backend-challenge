/**
 * Story 38 — reconciliation / crash-recovery end-to-end via HTTP.
 *
 * Simulates the operational scenario where a worker process died mid-run
 * leaving a hand-seeded workflow in an inconsistent shape:
 *   - Workflow.status = in_progress
 *   - step 1 (analysis, no deps): Completed (with a valid analysis output)
 *   - step 2 (analysis, deps [1]): InProgress — STRANDED (the crashed task)
 *   - step 3 (reportGeneration, deps [2]): Waiting
 *
 * Three-snapshot pattern locking in the single-pass reconcile contract
 * (TESTING_PRD Q6, Q8) and the subsequent end-to-end recovery via the
 * normal drain loop:
 *   1. Pre-reconcile: B InProgress, C Waiting.
 *   2. Post-reconcile, pre-drain: B reset to Queued; C still Waiting
 *      (single-pass — C not promoted because B is not yet Completed).
 *   3. Post-drain: workflow.status === completed; A, B, C all Completed;
 *      GET /:id/results returns 200 with finalResult populated.
 */
import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { DataSource } from "typeorm";
// Side-effect imports: ensure entity decorators register (and the
// WorkflowStatus enum is defined) before WorkflowFactory.ts runs.
import "../../src/models/Task";
import "../../src/models/Result";
import "../../src/models/Workflow";
import { Task } from "../../src/models/Task";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";
import { TaskStatus } from "../../src/workers/taskRunner";
import { reconcileTasks } from "../../src/workers/reconciliation";
import { createWorkflowRouter } from "../../src/routes/workflowRoutes";
import { makeDataSource } from "../_support/makeDataSource";
import { seedWorkflow } from "../_support/seedWorkflow";
import { makeTask, validGeoJson } from "../_support/makeTask";
import { drainQueuedTasks } from "../_support/drainQueuedTasks";

describe("reconciliation crash-recovery end-to-end", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await makeDataSource();
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("[story 38] reconciliation recovers stranded workflow and completes via HTTP", async () => {
    // Seed a workflow already mid-flight: one task done, one stranded
    // InProgress (the crashed worker), one downstream Waiting.
    const workflow = await seedWorkflow(dataSource, {
      status: WorkflowStatus.InProgress,
    });
    const taskRepo = dataSource.getRepository(Task);
    const a = makeTask(workflow, 1, TaskStatus.Completed, {
      taskType: "analysis",
      output: JSON.stringify("Brazil"),
    });
    const b = makeTask(workflow, 2, TaskStatus.InProgress, {
      taskType: "analysis",
      dependency: [1],
      overrides: { progress: "starting job..." },
    });
    const c = makeTask(workflow, 3, TaskStatus.Waiting, {
      taskType: "reportGeneration",
      dependency: [2],
      geoJson: validGeoJson,
    });
    await taskRepo.save([a, b, c]);

    const app = express();
    app.use(express.json());
    app.use("/workflow", createWorkflowRouter(dataSource));

    // Snapshot 1 — pre-reconcile: B InProgress, C Waiting.
    const snap1 = await request(app)
      .get(`/workflow/${workflow.workflowId}/status`)
      .query({ includeTasks: "true" });
    expect(snap1.status).toBe(200);
    expect(snap1.body).toMatchObject({
      workflowId: workflow.workflowId,
      status: WorkflowStatus.InProgress,
      completedTasks: 1,
      totalTasks: 3,
    });
    const byStep1 = (n: number) =>
      snap1.body.tasks.find((t: any) => t.stepNumber === n);
    expect(byStep1(1).status).toBe(TaskStatus.Completed);
    expect(byStep1(2).status).toBe(TaskStatus.InProgress);
    expect(byStep1(3).status).toBe(TaskStatus.Waiting);

    // Run the startup sweep — single pass: B (InProgress) → Queued, but C
    // (Waiting) NOT promoted because B is no longer Completed at the
    // promotion check (per TESTING_PRD Q6 single-pass lock).
    const sweep = await reconcileTasks(dataSource);
    expect(sweep).toEqual({ reset: 1, promoted: 0 });

    // Snapshot 2 — post-reconcile, pre-drain: B Queued, C still Waiting.
    const snap2 = await request(app)
      .get(`/workflow/${workflow.workflowId}/status`)
      .query({ includeTasks: "true" });
    expect(snap2.status).toBe(200);
    expect(snap2.body).toMatchObject({
      workflowId: workflow.workflowId,
      status: WorkflowStatus.InProgress,
      completedTasks: 1,
      totalTasks: 3,
    });
    const byStep2 = (n: number) =>
      snap2.body.tasks.find((t: any) => t.stepNumber === n);
    expect(byStep2(1).status).toBe(TaskStatus.Completed);
    expect(byStep2(2).status).toBe(TaskStatus.Queued);
    expect(byStep2(3).status).toBe(TaskStatus.Waiting);

    // Drain queue — B runs, completes; TaskRunner promotes C → Queued in
    // the same transaction; next iteration runs C → Completed; workflow
    // transitions to `completed` and finalResult is frozen.
    await drainQueuedTasks(dataSource);

    // Snapshot 3 — post-drain: workflow completed, all tasks Completed.
    const snap3 = await request(app)
      .get(`/workflow/${workflow.workflowId}/status`)
      .query({ includeTasks: "true" });
    expect(snap3.status).toBe(200);
    expect(snap3.body).toMatchObject({
      workflowId: workflow.workflowId,
      status: WorkflowStatus.Completed,
      completedTasks: 3,
      totalTasks: 3,
    });
    for (const step of [1, 2, 3]) {
      const t = snap3.body.tasks.find((x: any) => x.stepNumber === step);
      expect(t.status).toBe(TaskStatus.Completed);
    }

    const resultsRes = await request(app).get(
      `/workflow/${workflow.workflowId}/results`,
    );
    expect(resultsRes.status).toBe(200);
    expect(resultsRes.body.workflowId).toBe(workflow.workflowId);
    expect(resultsRes.body.status).toBe(WorkflowStatus.Completed);
    expect(resultsRes.body.totalTasks).toBe(3);
    expect(resultsRes.body.completedTasks).toBe(3);
  });
});
