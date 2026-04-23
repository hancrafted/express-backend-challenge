# Backend Coding Challenge

This repository demonstrates a backend architecture that handles asynchronous tasks, workflows, and job execution using TypeScript, Express.js, and TypeORM. The project showcases how to:

- Define and manage entities such as `Task` and `Workflow`.
- Use a `WorkflowFactory` to create workflows from YAML configurations.
- Implement a `TaskRunner` that executes jobs associated with tasks and manages task and workflow states.
- Run tasks asynchronously using a background worker.

## Key Features

1. **Entity Modeling with TypeORM**
   - **Task Entity:** Represents an individual unit of work with attributes like `taskType`, `status`, `progress`, and references to a `Workflow`.
   - **Workflow Entity:** Groups multiple tasks into a defined sequence or steps, allowing complex multi-step processes.

2. **Workflow Creation from YAML**
   - Use `WorkflowFactory` to load workflow definitions from a YAML file.
   - Dynamically create workflows and tasks without code changes by updating YAML files.

3. **Asynchronous Task Execution**
   - A background worker (`taskWorker`) continuously polls for `queued` tasks.
   - The `TaskRunner` runs the appropriate job based on a task’s `taskType`.

4. **Robust Status Management**
   - `TaskRunner` updates the status of tasks (from `queued` to `in_progress`, `completed`, or `failed`).
   - Workflow status is evaluated after each task completes, ensuring you know when the entire workflow is `completed` or `failed`.

5. **Dependency Injection and Decoupling**
   - `TaskRunner` takes in only the `Task` and determines the correct job internally.
   - `TaskRunner` handles task state transitions, leaving the background worker clean and focused on orchestration.

## Project Structure

```
src
├─ models/
│   ├─ world_data.json  # Contains world data for analysis
│
├─ models/
│   ├─ Result.ts        # Defines the Result entity
│   ├─ Task.ts          # Defines the Task entity
│   ├─ Workflow.ts      # Defines the Workflow entity
│
├─ jobs/
│   ├─ Job.ts           # Job interface
│   ├─ JobFactory.ts    # getJobForTaskType function for mapping taskType to a Job
│   ├─ TaskRunner.ts    # Handles job execution & task/workflow state transitions
│   ├─ DataAnalysisJob.ts (example)
│   ├─ EmailNotificationJob.ts (example)
│
├─ workflows/
│   ├─ WorkflowFactory.ts  # Creates workflows & tasks from a YAML definition
│
├─ workers/
│   ├─ taskWorker.ts    # Background worker that fetches queued tasks & runs them
│
├─ routes/
│   ├─ analysisRoutes.ts # POST /analysis endpoint to create workflows
│
├─ data-source.ts       # TypeORM DataSource configuration
└─ index.ts             # Express.js server initialization & starting the worker
```

## Getting Started

### Prerequisites
- Node.js (LTS recommended)
- npm or yarn
- SQLite or another supported database

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/backend-coding-challenge.git
   cd backend-coding-challenge
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure TypeORM:**
    - Edit `data-source.ts` to ensure the `entities` array includes `Task` and `Workflow` entities.
    - Confirm database settings (e.g. SQLite file path).

4. **Create or Update the Workflow YAML:**
    - Place a YAML file (e.g. `example_workflow.yml`) in a `workflows/` directory.
    - Define steps, for example:
      ```yaml
      name: "example_workflow"
      steps:
        - taskType: "analysis"
          stepNumber: 1
        - taskType: "notification"
          stepNumber: 2
      ```

### Running the Application

1. **Compile TypeScript (optional if using `ts-node`):**
   ```bash
   npx tsc
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

   If using `ts-node`, this will start the Express.js server and the background worker after database initialization.

3. **Create a Workflow (e.g. via `/analysis`):**
   ```bash
   curl -X POST http://localhost:3000/analysis \
   -H "Content-Type: application/json" \
   -d '{
    "clientId": "client123",
    "geoJson": {
        "type": "Polygon",
        "coordinates": [
            [
                [
                    -63.624885020050996,
                    -10.311050368263523
                ],
                [
                    -63.624885020050996,
                    -10.367865108370523
                ],
                [
                    -63.61278302732815,
                    -10.367865108370523
                ],
                [
                    -63.61278302732815,
                    -10.311050368263523
                ],
                [
                    -63.624885020050996,
                    -10.311050368263523
                ]
            ]
        ]
    }
    }'
   ```

   This will read the configured workflow YAML, create a workflow and tasks, and queue them for processing.

4. **Check Logs:**
    - The worker picks up tasks from `queued` state.
    - `TaskRunner` runs the corresponding job (e.g., data analysis, email notification) and updates states.
    - Once tasks are done, the workflow is marked as `completed`.


### **Coding Challenge Tasks for the Interviewee**

The following tasks must be completed to enhance the backend system:

---

### **1. Add a New Job to Calculate Polygon Area**
**Objective:**
Create a new job class to calculate the area of a polygon from the GeoJSON provided in the task.

#### **Steps:**
1. Create a new job file `PolygonAreaJob.ts` in the `src/jobs/` directory.
2. Implement the `Job` interface in this new class.
3. Use `@turf/area` to calculate the polygon area from the `geoJson` field in the task.
4. Save the result in the `output` field of the task.

#### **Requirements:**
- The `output` should include the calculated area in square meters.
- Ensure that the job handles invalid GeoJSON gracefully and marks the task as failed.

---

### **2. Add a Job to Generate a Report**
**Objective:**
Create a new job class to generate a report by aggregating the outputs of multiple tasks in the workflow.

#### **Steps:**
1. Create a new job file `ReportGenerationJob.ts` in the `src/jobs/` directory.
2. Implement the `Job` interface in this new class.
3. Aggregate outputs from all preceding tasks in the workflow into a JSON report. For example:
   ```json
   {
       "workflowId": "<workflow-id>",
       "tasks": [
           { "taskId": "<task-1-id>", "type": "polygonArea", "output": "<area>" },
           { "taskId": "<task-2-id>", "type": "dataAnalysis", "output": "<analysis result>" }
       ],
       "finalReport": "Aggregated data and results"
   }
   ```
4. Save the report as the `output` of the `ReportGenerationJob`.

#### **Requirements:**
- Ensure the job runs only after all preceding tasks are complete.
- Handle cases where tasks fail, and include error information in the report.

---

### **3. Support Interdependent Tasks in Workflows**
**Objective:**
Modify the system to support workflows with tasks that depend on the outputs of earlier tasks.

#### **Steps:**
1. Update the `Task` entity to include a `dependency` field that references another task
2. Modify the `TaskRunner` to wait for dependent tasks to complete and pass their outputs as inputs to the current task.
3. Extend the workflow YAML format to specify task dependencies (e.g., `dependsOn`).
4. Update the `WorkflowFactory` to parse dependencies and create tasks accordingly.

#### **Requirements:**
- Ensure dependent tasks do not execute until their dependencies are completed.
- Test workflows where tasks are chained through dependencies.

---

### **4. Ensure Final Workflow Results Are Properly Saved**
**Objective:**
Save the aggregated results of all tasks in the workflow as the `finalResult` field of the `Workflow` entity.

#### **Steps:**
1. Modify the `Workflow` entity to include a `finalResult` field:
2. Aggregate the outputs of all tasks in the workflow after the last task completes.
3. Save the aggregated results in the `finalResult` field.

#### **Requirements:**
- The `finalResult` must include outputs from all completed tasks.
- Handle cases where tasks fail, and include failure information in the final result.

---

### **5. Create an Endpoint for Getting Workflow Status**
**Objective:**
Implement an API endpoint to retrieve the current status of a workflow.

#### **Endpoint Specification:**
- **URL:** `/workflow/:id/status`
- **Method:** `GET`
- **Response Example:**
   ```json
   {
       "workflowId": "3433c76d-f226-4c91-afb5-7dfc7accab24",
       "status": "in_progress",
       "completedTasks": 3,
       "totalTasks": 5
   }
   ```

#### **Requirements:**
- Include the number of completed tasks and the total number of tasks in the workflow.
- Return a `404` response if the workflow ID does not exist.

---

### **6. Create an Endpoint for Retrieving Workflow Results**
**Objective:**
Implement an API endpoint to retrieve the final results of a completed workflow.

#### **Endpoint Specification:**
- **URL:** `/workflow/:id/results`
- **Method:** `GET`
- **Response Example:**
   ```json
   {
       "workflowId": "3433c76d-f226-4c91-afb5-7dfc7accab24",
       "status": "completed",
       "finalResult": "Aggregated workflow results go here"
   }
   ```

#### **Requirements:**
- Return the `finalResult` field of the workflow if it is completed.
- Return a `404` response if the workflow ID does not exist.
- Return a `400` response if the workflow is not yet completed.

---

### **Deliverables**
- **Code Implementation:**
   - New jobs: `PolygonAreaJob` and `ReportGenerationJob`.
   - Enhanced workflow support for interdependent tasks.
   - Workflow final results aggregation.
   - New API endpoints for workflow status and results.

- **Documentation:**
   - Update the README file to include instructions for testing the new features.
   - Document the API endpoints with request and response examples.

---

### **Design Notes**

These notes capture the design decisions reached during planning,
organised by Todo. For each decision the alternatives considered are
summarised so the reviewer can follow the trade-off reasoning without
opening the PRD. The PRD itself holds the full implementation spec.

#### Cross-cutting

**Test framework — `vitest`.** Chosen over `jest` (heavy dep tree,
separate `ts-jest` config) and Node's built-in `node:test` (thin
assertion/mock vocabulary). Vitest runs TypeScript natively, boots in
~200ms, and its API is jest-identical for reviewer familiarity.

**Implementation strategy — Red–Green–Refactor (TDD), strictly.** Every
module listed in the PRD's Testing Decisions is written test-first.
Sequencing: `workflowSummary` aggregation → `PolygonAreaJob` →
`ReportGenerationJob` → entity / factory changes → `TaskRunner` →
reconciliation sweep → HTTP routes.

**Crash recovery.** Interdependent tasks introduce two stranded-state
failure modes on process crash: tasks stuck in `in_progress`, and
`waiting` tasks whose parents completed but whose `waiting → queued`
promotion was never written. Closed by (a) a startup reconciliation
sweep that resets orphaned `in_progress` tasks and promotes `waiting`
tasks whose dependencies are all `completed`, and (b) wrapping "mark
parent completed + promote children" in a single TypeORM transaction.
A full **lease / heartbeat model** (per-task `leasedAt` / `leaseOwner`,
expired-lease reclaim, job-level idempotency keys) was considered for
production-grade deployment but rejected as over-engineered for this
challenge. Jobs are assumed idempotent; duplicate-side-effect prevention
(e.g. re-sending an email on retry) is out of scope.

---

#### Todo #1 — Polygon Area Job

**Q: Where should task output live?** The starting code writes each
task's output to a separate `Result` row via `Task.resultId`; the spec
asks for an `output` field on `Task`.
- Options: (A) reuse `Result`, (B) migrate fully to `Task.output` and
  delete `Result`, (C) add `Task.output` alongside `Result` and keep both.
- **Decision: C.** Take the spec literally; leave `Result` untouched to
  minimise diff and avoid breaking starter-code callers. Rationalising
  the two is flagged as a follow-up in the PRD.

**Q: How should invalid GeoJSON be signalled?**
- Options: (A) throw a descriptive `Error` — `TaskRunner`'s existing
  catch marks the task `failed`, (B) return a structured `{ok:false}`
  sentinel and stay `completed`, (C) categorised errors with an
  `errorKind` column on `Task`.
- **Decision: A.** Matches the Readme literally ("marks the task as
  failed"). B would break the fail-fast cascade — children would see the
  parent as "completed". C is schema churn for information that fits in
  the error message string.

---

#### Todo #2 — Report Generation Job

No open design questions unique to this Todo — the output contract is
settled by Todo #1 (`Task.output`), fan-in dependency semantics by
Todo #3, and failed-task inclusion by Todo #4. `ReportGenerationJob` is
a thin adapter that reads `context.dependencyOutputs`, shapes the
Readme-example body, and returns the object. Under fail-fast it never
runs on the failure path; the workflow-level `finalResult` (Todo #4) is
the failure-path surface instead.

---

#### Todo #3 — Interdependent Tasks

**Q: YAML and DB form for dependencies.**
- Options: (A) YAML uses stepNumbers, DB stores resolved parent UUIDs,
  (B) both YAML and DB use stepNumbers, (C) a separate
  `task_dependencies` join table.
- **Decision: B.** Indexes wouldn't help either column form
  (`Task.dependency` is a JSON array); lookups go child → parents and
  are satisfied by in-memory iteration over the already-loaded
  `workflow.tasks` collection. StepNumbers keep the SQLite row directly
  auditable. C is the production-grade answer but over-plumbing here.

**Q: How does the worker know a task is ready?**
- Options: (A) keep single `Queued` status, filter readiness in the poll
  query every tick, (B) add a `Waiting` status and promote `Waiting →
  Queued` when deps complete, (C) sequential by stepNumber, no fan-in.
- **Decision: B.** The Readme's Report example is fan-in by nature, so C
  sacrifices correctness for simplicity. B is cheaper than A at scale
  (readiness computed on transition, not every 5s poll) and makes
  "blocked" visible in the DB instead of invisible. A's self-healing
  property is replicated by the transactional promotion + startup sweep
  (see Cross-cutting).

**Q: How are dependency outputs passed into a job?**
- Options: (A) the job reads them from the DB itself, (B) `TaskRunner`
  passes a typed `JobContext = { dependencyOutputs: Record<stepNumber,
  unknown> }` second argument, (C) purely in-memory, no DB round-trip.
- **Decision: B.** Keeps jobs pure (no ORM dependency), keeps
  `TaskRunner` the single arbiter of task inputs, and survives crashes
  (context is rebuilt from persisted `Task.output` on restart). Existing
  jobs that ignore the second argument need only a signature widening.

**Q: Failure cascade semantics.**
- Options: (A) dependents still run with `undefined` parent output,
  (B) fail-fast — any failure marks all transitive dependents `failed`
  without executing, (C) per-task `continueOnFailure` YAML flag.
- **Decision: B.** Simplest semantics consistent with the Todo wording
  ("do not execute until dependencies are completed"); keeps jobs free
  of defensive upstream-state checks. Per-task retry policy, critical-
  path awareness, and user notification on workflow failure are flagged
  as production extensions and are out of scope.

---

#### Todo #4 — Final Workflow Results

**Q: Who owns `finalResult`?**
- Options: (A) computed only when a `ReportGenerationJob` is present,
  (B) framework-owned — `TaskRunner` snapshots it on any terminal
  transition, (C) both (user report on success, framework fallback on
  failure).
- **Decision: B.** `finalResult` is a framework audit-trail artefact;
  making it contingent on a user-defined job means failed workflows
  would have no durable record. A user `ReportGenerationJob`'s output
  still lives inside `finalResult.tasks[]` as one entry — no loss of
  information.

**Q: What does `finalResult` look like for a *failed* workflow?**
- Options: (A) only successful tasks listed, (B) every task listed with
  its terminal status and either `output` or `error`, including
  skipped-cascade tasks with `error: "Skipped: dependency <step>
  failed"`, (C) a flat failure summary only (which step failed, which
  error).
- **Decision: B.** Satisfies Todo #4's "include failure information"
  requirement and makes the `/results` response self-explanatory: a
  reader can see exactly where a workflow terminated and why. Ordered by
  `stepNumber` ascending so the narrative reads top-to-bottom.

Together these settle that `workflowSummary` is a **single pure
aggregation module** consumed by three callers: `TaskRunner` on terminal
transition, `/workflow/:id/status` (live), and `/workflow/:id/results`
(parsing `finalResult` back out).

---

#### Todo #5 — Workflow Status Endpoint

**Q: Body schema, and what counts as a "completed" task?**
- Options: (A) strict Readme literal — four fields only,
  `completedTasks` = count of `status === completed`, (B) optional
  `?includeTasks=true` query flag to additionally return a per-task
  breakdown, (C) always return the full per-task list.
- **Decision: B.** `completedTasks` counts only tasks with
  `status === completed` — terminal-failed tasks are not counted, so
  `completed + failed ≤ totalTasks` may hold legitimately.
  `?includeTasks=true` opt-in gives clients a detail view without
  bloating the default polling payload. Body reuses the unified schema
  from Todo #4 so the two endpoints can never drift.

---

#### Todo #6 — Workflow Results Endpoint

**Q: What is the correct response for a *failed* workflow?** The spec
says return `400` when the workflow is "not yet completed" — ambiguous
between "not yet in a terminal state" and "not yet
`status === completed`".
- Options: (A) strict literal — `failed` → 400 alongside `in_progress`,
  (B) terminal → 200 — both `completed` and `failed` workflows return
  200 with their `finalResult`, only non-terminal states receive 400,
  (C) different HTTP codes per terminal state (e.g. 200 vs 207).
- **Decision: B.** Todos #2 and #4 require the system to produce rich
  failure information; returning 400 on failed (A) would strand exactly
  that information behind an error code. Read "not yet completed" as
  "not yet in a terminal state". The response body's `status` field
  distinguishes success from failure at the application layer. C
  misuses HTTP status codes (207 is for WebDAV batch responses).

---


### **Production Considerations (Considered, Deferred)**

The decisions below list production-grade alternatives that were
considered during planning and explicitly deferred because they are
over-scope for this coding challenge. They are recorded here so a
reviewer can see that the narrower scope is deliberate, not an
oversight. Full rationale and concrete migration paths live in the
PRD's design notes; this section is the one-line index.

#### Concurrency & execution

- **Task claim is not race-safe across workers.** Current:
  `findOne({ status: Queued })`, single worker assumed. Production:
  atomic claim with `SELECT … FOR UPDATE SKIP LOCKED` on Postgres (or
  a compare-and-swap `UPDATE` on SQLite) against `lease_owner` /
  `lease_expires_at` columns on `Task`.
- **Crash recovery is boot-gated.** Current: startup reconciliation
  sweep resets stranded `in_progress` / `waiting` rows. Production:
  continuous lease expiry + heartbeats so mid-run hangs are reclaimed
  too, not just clean crashes.
- **Scheduler is edge-triggered only.** Current: `TaskRunner`
  maintains readiness invariant at transitions. Production: retain
  edge-triggered for latency and add a periodic level-triggered sweep
  as a correctness net; optionally `LISTEN/NOTIFY` to replace polling.

#### Dependency graph

- **Dependencies stored as JSON array of stepNumbers.** Current:
  `Task.dependency: text`. Production: explicit `task_dependencies`
  join table keyed by UUIDs, with indexes on both sides; enables SQL
  readiness predicates and scales to large DAGs.
- **No submit-time validation.** Current: `WorkflowFactory` trusts
  the YAML. Production: cycle detection, duplicate-step rejection,
  and reference-integrity checks on `POST /analysis`, returning
  `400` before anything is persisted.

#### Retry, idempotency, failure policy

- **No retry policy.** Current: fail-fast, one attempt. Production:
  per-task `retry: { maxAttempts, backoff, initialDelay, maxDelay }`
  in YAML, plus `attempt_count` / `next_attempt_at` on `Task`.
- **No dead-letter queue.** Current: terminal `failed` tasks sit in
  place. Production: separate `dead_letter_tasks` state or table,
  plus an operator replay endpoint.
- **No `continueOnFailure` flag.** Current: any failure cascades to
  all transitive dependents unconditionally. Production: per-task
  flag lets downstream jobs run with partial inputs (primary use
  case: best-effort `ReportGenerationJob`).
- **Job idempotency is assumed, not enforced.** Current: external
  side-effects (e.g. re-sent emails) may duplicate on retry.
  Production: `Task.idempotency_key` propagated into external calls
  as a dedup token.

#### Persistence & schema

- **`dropSchema: true` on every boot.** Current: convenient for
  iteration. Production: TypeORM migrations, `synchronize: false`,
  `dropSchema: false`, migration step in the deploy pipeline.
- **`Task.output` and `Workflow.finalResult` stored as stringified
  JSON `text`.** Current: SQLite-compatible. Production on Postgres:
  `jsonb` columns with GIN indexes on queryable paths; removes the
  app-layer parse/stringify round-trip.
- **`Task.output` added alongside legacy `Result` entity.** Current:
  dual-write kept to minimise the diff. Production: consolidate —
  `Task.output` becomes canonical, `Result` and `Task.resultId`
  dropped after a backfill migration.
- **No indexes defined on `tasks`.** Production: at minimum
  `(status, created_at)`, `(workflow_id)`, and a partial index on
  `(lease_expires_at) WHERE status='in_progress'` for the reclaimer.

#### HTTP surface

- **No authentication or authorisation.** Current: any caller may
  read any workflow. Production: JWT bearer auth + `clientId`
  ownership check on every workflow-scoped endpoint; `404` for
  existence hiding where the threat model requires it.
- **No rate limiting.** `GET /workflow/:id/status` is a natural
  polling target. Production: token-bucket limiter (e.g.
  `express-rate-limit` + Redis) with tighter limits on write
  endpoints, `429` + `Retry-After` on breach.
- **No caching on `/status`.** Current: every poll re-aggregates
  from the DB. Production: `ETag` + `If-None-Match` → `304`
  short-circuit, or replace polling with SSE / WebSocket on a
  `/workflow/:id/stream` endpoint.
- **No pagination on `?includeTasks=true`.** Production: cursor
  pagination once task count exceeds a threshold (e.g. 50).
- **`POST /analysis` is not idempotent.** Production: honour an
  `Idempotency-Key` request header; repeated submissions return the
  original workflow rather than creating duplicates.
- **No API versioning.** Current: `/workflow/:id/status`.
  Production: `/v1/workflow/:id/status` — cheap forward compatibility.
- **No per-task detail endpoint.** Production:
  `GET /v1/workflow/:id/task/:stepNumber` returning attempt history,
  raw `output` / `error`, and lease state — essential for debugging
  a failed workflow.

#### Observability

- **No structured logging.** Production: `pino` JSON logs with
  `workflowId` / `taskId` / `stepNumber` / `taskType` / `attempt` on
  every line; one log per state transition.
- **No metrics.** Production: Prometheus (`prom-client`) — counter
  per `(task_type, terminal_status)`, histogram on task duration,
  gauge on queue depth per status, exposed at `/metrics`.
- **No tracing.** Production: OpenTelemetry spans per task execution,
  parented by a workflow-level span, correlated with the originating
  `POST /analysis` request span.
- **No health endpoints.** Production: `GET /healthz` (liveness) and
  `GET /readyz` (readiness — DB reachable, worker tick fresh).

#### Downstream delivery

- **`finalResult` is pull-only.** Current: clients must poll
  `/results`. Production: webhook (registered at submit time, signed
  with HMAC) or pub-sub emission (Kafka / SNS) on any terminal
  transition; the delivery itself obeys the retry / DLQ policy above.

#### Testing

- **Route handlers untested.** Production: `supertest` coverage of
  `200` / `400` / `404` on both endpoints, including auth and
  rate-limit middleware.
- **Worker loop untested.** Production: at least one integration
  test that runs the real worker against in-memory SQLite to
  terminal convergence — catches tick coalescing and restart races
  that isolated `TaskRunner` tests cannot see.
- **No fault-injection.** Production: kill-mid-transaction tests
  asserting DB consistency after `manager.transaction` is
  interrupted. This is the test that justifies the "transactional
  promotion + reconciliation" architecture.

#### Scheduler scale ceiling

The hand-rolled scheduler in `TaskRunner` + `taskWorker` is a correct
choice at this scale. Beyond roughly 10⁴ workflows/day per worker, or
in any multi-region deployment, migrate to a durable-execution engine
(**Temporal**, **BullMQ**, or **Inngest**) rather than growing this
one further. The `Job` / `WorkflowFactory` abstractions map cleanly
onto Temporal's activity / workflow model; the port is mostly
deletions.

---
