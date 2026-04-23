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
