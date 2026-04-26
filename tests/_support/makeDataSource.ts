import { DataSource } from "typeorm";
import { Task } from "../../src/models/Task";
import { Result } from "../../src/models/Result";
import { Workflow } from "../../src/models/Workflow";

/**
 * Returns a fresh, initialized in-memory SQLite DataSource configured with
 * the workflow engine entities. Mirrors the beforeEach setup used across
 * tests/workers, tests/workflows, tests/routes, and tests/integration.
 */
export async function makeDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: "sqlite",
    database: ":memory:",
    dropSchema: true,
    synchronize: true,
    entities: [Task, Result, Workflow],
  });
  await dataSource.initialize();
  return dataSource;
}
