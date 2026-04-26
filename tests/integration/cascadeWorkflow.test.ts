/**
 * Story 36 — failure cascade end-to-end via HTTP.
 *
 * Inverted counterpart of `tests/integration/fanInWorkflow.test.ts` (the
 * happy-path fan-in version). Drives the same 3-step example workflow
 * (polygonArea + analysis -> reportGeneration[deps:1,2]) but with invalid
 * GeoJSON so step 1 (polygonArea) fails. Locks in the existing TaskRunner
 * failure semantics: step 1 fails with "Invalid GeoJSON …", step 3
 * (reportGeneration) is cascade-skipped via "Skipped: dependency 1 failed",
 * step 2 (analysis, parallel to step 1) is NOT cascaded and instead surfaces
 * its own JSON-parse error. Workflow transitions to `failed`, finalResult
 * is populated, and both errors and status are observable via the HTTP
 * routes.
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
import { TaskStatus } from "../../src/workers/taskRunner";
import { createWorkflowRouter } from "../../src/routes/workflowRoutes";
import { makeDataSource } from "../_support/makeDataSource";
import { drainQueuedTasks } from "../_support/drainQueuedTasks";

describe("cascade workflow end-to-end (invalid GeoJSON -> polygonArea fails -> downstream skipped)", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await makeDataSource();
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("[story 36] failure cascades end-to-end and surfaces via HTTP", async () => {
    const yamlPath = path.join(__dirname, "../../src/workflows/example_workflow.yml");
    const invalidGeoJson = "this is not json";
    const factory = new WorkflowFactory(dataSource);
    const workflow = await factory.createWorkflowFromYAML(yamlPath, "demo", invalidGeoJson);

    await drainQueuedTasks(dataSource);

    const app = express();
    app.use(express.json());
    app.use("/workflow", createWorkflowRouter(dataSource));

    const statusRes = await request(app).get(`/workflow/${workflow.workflowId}/status`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({
      workflowId: workflow.workflowId,
      status: WorkflowStatus.Failed,
      totalTasks: 3,
    });

    const resultsRes = await request(app).get(`/workflow/${workflow.workflowId}/results`);
    expect(resultsRes.status).toBe(200);

    const finalResult = resultsRes.body;
    expect(finalResult.workflowId).toBe(workflow.workflowId);
    expect(finalResult.status).toBe(WorkflowStatus.Failed);
    expect(finalResult.totalTasks).toBe(3);
    expect(Array.isArray(finalResult.tasks)).toBe(true);
    expect(finalResult.tasks).toHaveLength(3);
    expect(finalResult.tasks.map((t: any) => t.stepNumber)).toEqual([1, 2, 3]);
    expect(finalResult.tasks.map((t: any) => t.taskType)).toEqual([
      "polygonArea",
      "analysis",
      "reportGeneration",
    ]);

    // Per-task error assertions read from the DB rather than `finalResult`
    // because TaskRunner freezes `Workflow.finalResult` at the first moment
    // the workflow becomes terminal — i.e. as soon as step 1 (polygonArea)
    // fails. At that instant step 2 (analysis, no dependency on step 1) is
    // still `queued`; it later runs + fails on its own JSON.parse, but the
    // already-frozen `finalResult` is not refreshed. The DB row, by
    // contrast, reflects every Task's final state after the drain.
    const taskRepo = dataSource.getRepository(Task);
    const tasks = await taskRepo.find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
      order: { stepNumber: "ASC" },
    });
    expect(tasks).toHaveLength(3);
    for (const t of tasks) {
      expect(t.status).toBe(TaskStatus.Failed);
      expect(typeof t.error).toBe("string");
      expect((t.error ?? "").length).toBeGreaterThan(0);
    }

    const byType = (type: string) => tasks.find(t => t.taskType === type)!;
    expect(byType("polygonArea").error).toMatch(/invalid geojson/i);
    // Step 3 (reportGeneration) depends transitively on step 1, so the
    // cascade marks it skipped with the canonical "Skipped: dependency N
    // failed" message.
    expect(byType("reportGeneration").error).toMatch(/skipped|dependency.*failed/i);
    // Step 2 (analysis) is parallel to step 1 — not a downstream dependent
    // — so it is NOT cascade-skipped. It runs after step 1 fails and
    // surfaces its own JSON-parse error from `DataAnalysisJob`.
    expect(byType("analysis").error).toMatch(/json|unexpected token/i);
  });
});
