/**
 * Scale test for `WorkflowFactory.createWorkflowFromYAML`.
 *
 * Covers TESTING_PRD stories:
 *   - story 30: parses + persists a 100-step YAML graph with mixed dependencies.
 *
 * YAML shape:
 *   - Linear chain across steps 1..99 (step 1 has no deps; step k>1 depends
 *     on step k-1) — produced via buildLinearChainYaml(99) from
 *     tests/_support/buildYaml.ts.
 *   - Fan-in spine: step 100 (`reportGeneration`) depends on every odd step
 *     in [1, 3, 5, …, 99] — appended inline because the existing helpers
 *     don't compose into this exact shape.
 *
 * Per TESTING_PRD Q13: NO wall-clock assertion — duration is informational.
 */
import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { WorkflowFactory } from "../../src/workflows/WorkflowFactory";
import { TaskStatus } from "../../src/workers/taskRunner";
import { makeDataSource } from "../_support/makeDataSource";
import { buildLinearChainYaml } from "../_support/buildYaml";

describe("[story 30] WorkflowFactory at 100 steps", () => {
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
    const p = path.join(os.tmpdir(), `wf-scale-${Date.now()}-${Math.random()}.yml`);
    fs.writeFileSync(p, content, "utf8");
    tmpFiles.push(p);
    return p;
  }

  const geoJson = JSON.stringify({
    type: "Polygon",
    coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
  });

  it("[story 30] parses + persists 100-step YAML with mixed dependencies", async () => {
    const oddSteps = Array.from({ length: 50 }, (_, i) => 2 * i + 1); // [1, 3, …, 99]
    const chain = buildLinearChainYaml(99); // steps 1..99 linear chain
    const fanInLines = [
      `  - taskType: "reportGeneration"`,
      `    stepNumber: 100`,
      `    dependsOn: [${oddSteps.join(", ")}]`,
      "",
    ].join("\n");
    const yamlPath = writeYaml(chain + fanInLines);

    const factory = new WorkflowFactory(dataSource);
    const start = Date.now();
    const workflow = await factory.createWorkflowFromYAML(yamlPath, "client-scale", geoJson);
    const elapsedMs = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[story 30] createWorkflowFromYAML(100 steps) took ${elapsedMs}ms`);

    const tasks = await dataSource.getRepository(Task).find({
      where: { workflow: { workflowId: workflow.workflowId } },
      relations: ["workflow"],
    });
    const byStep = new Map(tasks.map(t => [t.stepNumber, t]));

    expect(tasks).toHaveLength(100);
    expect([...byStep.keys()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );

    expect(byStep.get(1)?.dependency ?? null).toBeNull();
    expect(byStep.get(1)?.status).toBe(TaskStatus.Queued);

    for (let k = 2; k <= 99; k++) {
      const t = byStep.get(k);
      expect(t).toBeDefined();
      expect(t!.dependency).not.toBeNull();
      expect(JSON.parse(t!.dependency as string)).toEqual([k - 1]);
      expect(t!.status).toBe(TaskStatus.Waiting);
    }

    const step100 = byStep.get(100);
    expect(step100).toBeDefined();
    expect(step100!.dependency).not.toBeNull();
    expect(JSON.parse(step100!.dependency as string)).toEqual(oddSteps);
    expect(step100!.status).toBe(TaskStatus.Waiting);
    expect(step100!.taskType).toBe("reportGeneration");
  });
});
