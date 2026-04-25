/**
 * Tests for `WorkflowFactory.createWorkflowFromYAML`.
 *
 * Covers TESTING_PRD stories:
 *   - story 6  (existing): dependsOn YAML → Task.dependency JSON form
 *   - story 16 (this file): PIN current permissive behavior for malformed
 *                            YAML (cycle / duplicate stepNumber / dangling
 *                            dep / missing `steps` key). LOCK semantics —
 *                            see TESTING_PRD §"Further Notes". The factory
 *                            performs no cycle / duplicate / dangling-dep /
 *                            missing-steps validation today; these tests
 *                            make that absence observable so that any
 *                            future commit which adds validation has to
 *                            update them intentionally.
 *   - story 29 (this file): tasks persist with stepNumbers + dependency
 *                            JSON driven by YAML content, not file order.
 */
import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";
import { WorkflowFactory } from "../../src/workflows/WorkflowFactory";
import { TaskStatus } from "../../src/workers/taskRunner";
import { makeDataSource } from "../_support/makeDataSource";

describe("WorkflowFactory dependsOn parsing", () => {
  let dataSource: DataSource;
  let tmpFiles: string[] = [];

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
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    tmpFiles = [];
  });

  function writeYaml(content: string): string {
    const p = path.join(os.tmpdir(), `wf-${Date.now()}-${Math.random()}.yml`);
    fs.writeFileSync(p, content, "utf8");
    tmpFiles.push(p);
    return p;
  }

  const geoJson = JSON.stringify({
    type: "Polygon",
    coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
  });

  it("persists dependency as JSON string and initial status Waiting for steps with dependsOn", async () => {
    const yamlPath = writeYaml(
      [
        'name: "deps_workflow"',
        "steps:",
        '  - taskType: "polygonArea"',
        "    stepNumber: 1",
        '  - taskType: "analysis"',
        "    stepNumber: 2",
        "    dependsOn: [1]",
      ].join("\n"),
    );

    const factory = new WorkflowFactory(dataSource);
    const workflow = await factory.createWorkflowFromYAML(yamlPath, "client-1", geoJson);

    const taskRepo = dataSource.getRepository(Task);
    const tasks = await taskRepo.find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
    });
    const byStep = new Map(tasks.map(t => [t.stepNumber, t]));

    expect(byStep.get(1)?.dependency ?? null).toBeNull();
    expect(byStep.get(1)?.status).toBe(TaskStatus.Queued);

    expect(byStep.get(2)?.dependency).toBe(JSON.stringify([1]));
    expect(byStep.get(2)?.status).toBe(TaskStatus.Waiting);
  });

  it("leaves dependency null and status Queued for steps without dependsOn", async () => {
    const yamlPath = writeYaml(
      [
        'name: "no_deps_workflow"',
        "steps:",
        '  - taskType: "polygonArea"',
        "    stepNumber: 1",
        '  - taskType: "notification"',
        "    stepNumber: 2",
      ].join("\n"),
    );

    const factory = new WorkflowFactory(dataSource);
    const workflow = await factory.createWorkflowFromYAML(yamlPath, "client-2", geoJson);

    const taskRepo = dataSource.getRepository(Task);
    const tasks = await taskRepo.find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
    });

    for (const t of tasks) {
      expect(t.dependency ?? null).toBeNull();
      expect(t.status).toBe(TaskStatus.Queued);
    }
  });
});

describe("[stories 16, 29] permissive YAML + stepNumber ordering", () => {
  let dataSource: DataSource;
  let tmpFiles: string[] = [];

  beforeEach(async () => {
    dataSource = await makeDataSource();
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    tmpFiles = [];
  });

  function writeYaml(content: string): string {
    const p = path.join(os.tmpdir(), `wf-${Date.now()}-${Math.random()}.yml`);
    fs.writeFileSync(p, content, "utf8");
    tmpFiles.push(p);
    return p;
  }

  const geoJson = JSON.stringify({
    type: "Polygon",
    coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
  });

  it("[story 16] persists a 2-step cycle (1↔2) without rejecting it", async () => {
    // LOCK: documents current permissive behavior — see TESTING_PRD §"Further Notes"
    const yamlPath = writeYaml(
      [
        'name: "cycle_workflow"',
        "steps:",
        '  - taskType: "polygonArea"',
        "    stepNumber: 1",
        "    dependsOn: [2]",
        '  - taskType: "polygonArea"',
        "    stepNumber: 2",
        "    dependsOn: [1]",
      ].join("\n"),
    );

    const factory = new WorkflowFactory(dataSource);
    const workflow = await factory.createWorkflowFromYAML(yamlPath, "client-cycle", geoJson);

    const tasks = await dataSource.getRepository(Task).find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
    });
    const byStep = new Map(tasks.map(t => [t.stepNumber, t]));

    expect(tasks).toHaveLength(2);
    expect(byStep.get(1)?.dependency).toBe(JSON.stringify([2]));
    expect(byStep.get(1)?.status).toBe(TaskStatus.Waiting);
    expect(byStep.get(2)?.dependency).toBe(JSON.stringify([1]));
    expect(byStep.get(2)?.status).toBe(TaskStatus.Waiting);
  });

  it("[story 16] persists duplicate stepNumber rows without de-duplicating", async () => {
    // LOCK: documents current permissive behavior — see TESTING_PRD §"Further Notes"
    const yamlPath = writeYaml(
      [
        'name: "dup_step_workflow"',
        "steps:",
        '  - taskType: "polygonArea"',
        "    stepNumber: 1",
        '  - taskType: "notification"',
        "    stepNumber: 1",
      ].join("\n"),
    );

    const factory = new WorkflowFactory(dataSource);
    const workflow = await factory.createWorkflowFromYAML(yamlPath, "client-dup", geoJson);

    const tasks = await dataSource.getRepository(Task).find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
    });

    expect(tasks).toHaveLength(2);
    expect(tasks.every(t => t.stepNumber === 1)).toBe(true);
    const taskTypes = tasks.map(t => t.taskType).sort();
    expect(taskTypes).toEqual(["notification", "polygonArea"]);
    for (const t of tasks) {
      expect(t.dependency ?? null).toBeNull();
      expect(t.status).toBe(TaskStatus.Queued);
    }
  });

  it("[story 16] persists a dangling dep ([99] with no such step) verbatim", async () => {
    // LOCK: documents current permissive behavior — see TESTING_PRD §"Further Notes"
    const yamlPath = writeYaml(
      [
        'name: "dangling_dep_workflow"',
        "steps:",
        '  - taskType: "polygonArea"',
        "    stepNumber: 1",
        "    dependsOn: [99]",
      ].join("\n"),
    );

    const factory = new WorkflowFactory(dataSource);
    const workflow = await factory.createWorkflowFromYAML(yamlPath, "client-dangling", geoJson);

    const tasks = await dataSource.getRepository(Task).find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].stepNumber).toBe(1);
    expect(tasks[0].dependency).toBe(JSON.stringify([99]));
    expect(tasks[0].status).toBe(TaskStatus.Waiting);
  });

  it("[story 16] throws when YAML omits the `steps` key entirely", async () => {
    // LOCK: documents current permissive behavior — see TESTING_PRD §"Further Notes"
    // No defensive guard around `workflowDef.steps.map(...)`, so a missing
    // `steps` key surfaces as a TypeError from the .map() call rather than
    // a domain-specific validation error.
    const yamlPath = writeYaml('name: "x"\n');

    const factory = new WorkflowFactory(dataSource);
    await expect(
      factory.createWorkflowFromYAML(yamlPath, "client-missing-steps", geoJson),
    ).rejects.toThrow(TypeError);
  });

  it("[story 29] persists tasks with stepNumbers + dependency JSON driven by YAML content, not file order", async () => {
    // YAML lists steps in file order [3, 1, 2] but defines a chain 1 → 2 → 3
    // via dependsOn. Ordering is content-driven (stepNumber + dependsOn),
    // not file-position driven.
    const yamlPath = writeYaml(
      [
        'name: "ordered_workflow"',
        "steps:",
        '  - taskType: "polygonArea"',
        "    stepNumber: 3",
        "    dependsOn: [2]",
        '  - taskType: "polygonArea"',
        "    stepNumber: 1",
        '  - taskType: "polygonArea"',
        "    stepNumber: 2",
        "    dependsOn: [1]",
      ].join("\n"),
    );

    const factory = new WorkflowFactory(dataSource);
    const workflow = await factory.createWorkflowFromYAML(yamlPath, "client-ordered", geoJson);

    const tasks = await dataSource.getRepository(Task).find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
    });
    const byStep = new Map(tasks.map(t => [t.stepNumber, t]));

    expect(tasks).toHaveLength(3);
    expect([...byStep.keys()].sort()).toEqual([1, 2, 3]);

    expect(byStep.get(1)?.dependency ?? null).toBeNull();
    expect(byStep.get(1)?.status).toBe(TaskStatus.Queued);

    expect(byStep.get(2)?.dependency).toBe(JSON.stringify([1]));
    expect(byStep.get(2)?.status).toBe(TaskStatus.Waiting);

    expect(byStep.get(3)?.dependency).toBe(JSON.stringify([2]));
    expect(byStep.get(3)?.status).toBe(TaskStatus.Waiting);
  });
});
