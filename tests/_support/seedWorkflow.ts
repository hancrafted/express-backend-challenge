import { DataSource } from "typeorm";
import { Workflow } from "../../src/models/Workflow";
import { WorkflowStatus } from "../../src/workflows/WorkflowFactory";

/**
 * Saves and returns a Workflow row using the test-default fields
 * (`clientId="client-test"`, `status=Initial`). Pass `overrides` to
 * customise any field before save (e.g. `{ status: WorkflowStatus.InProgress }`).
 */
export async function seedWorkflow(
  dataSource: DataSource,
  overrides: Partial<Workflow> = {},
): Promise<Workflow> {
  const workflowRepo = dataSource.getRepository(Workflow);
  const workflow = new Workflow();
  workflow.clientId = "client-test";
  workflow.status = WorkflowStatus.Initial;
  Object.assign(workflow, overrides);
  return await workflowRepo.save(workflow);
}
