import { Task } from "../../src/models/Task";
import { Workflow } from "../../src/models/Workflow";
import { TaskStatus } from "../../src/workers/taskRunner";

/**
 * Default valid GeoJSON polygon (Brazil square) reused across worker tests.
 */
export const validGeoJson = JSON.stringify({
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

export interface MakeTaskOptions {
  dependency?: number[] | null;
  taskType?: string;
  geoJson?: string;
  output?: string | null;
  clientId?: string;
  /** Arbitrary extra Task fields applied last (e.g. `progress`, `error`). */
  overrides?: Partial<Task>;
}

/**
 * Builds an unsaved Task entity wired to `workflow`. Defaults match the
 * inlined `makeTask` helpers across tests/workers (clientId="client-test",
 * taskType="polygonArea", geoJson=validGeoJson). Caller is responsible for
 * persisting via `taskRepo.save(...)`.
 */
export function makeTask(
  workflow: Workflow,
  stepNumber: number,
  status: TaskStatus,
  opts: MakeTaskOptions = {},
): Task {
  const task = new Task();
  task.clientId = opts.clientId ?? "client-test";
  task.geoJson = opts.geoJson ?? validGeoJson;
  task.taskType = opts.taskType ?? "polygonArea";
  task.status = status;
  task.stepNumber = stepNumber;
  task.dependency = opts.dependency ? JSON.stringify(opts.dependency) : null;
  if (opts.output !== undefined) task.output = opts.output;
  task.workflow = workflow;
  if (opts.overrides) Object.assign(task, opts.overrides);
  return task;
}
