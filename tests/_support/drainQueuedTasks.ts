import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { TaskRunner, TaskStatus } from "../../src/workers/taskRunner";

/**
 * Inlined taskWorker loop (no setTimeout) — runs `TaskRunner` against every
 * Queued task until none remain. Lifted from
 * `tests/integration/fanInWorkflow.test.ts` so the new integration tests
 * (cascade, mid-drain, recovery) and scale tests can reuse the same drain
 * pattern. The `maxIterations` safety bound prevents infinite loops if a
 * bug leaves tasks queued; defaults to 200 to accommodate 100-task scale
 * workflows.
 */
export async function drainQueuedTasks(
  dataSource: DataSource,
  maxIterations: number = 200,
): Promise<void> {
  const taskRepository = dataSource.getRepository(Task);
  const runner = new TaskRunner(taskRepository);

  for (let i = 0; i < maxIterations; i++) {
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
