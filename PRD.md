# PRD — Backend Coding Challenge: Workflow Engine Enhancements

> Synthesised from the six todos in `Readme.md` (§ "Coding Challenge Tasks
> for the Interviewee") and the design decisions resolved in the Grill-Me
> interview session. Production-grade extensions noted but explicitly
> out of scope; see Readme § Design Notes.

## Problem Statement

As a backend engineer reviewing this challenge, I need the existing
workflow engine to support polygon-area computation, report generation,
interdependent tasks, terminal-state result aggregation, and two HTTP
endpoints for polling workflow status and retrieving final results — so
that clients submitting geospatial analysis jobs can (a) observe
progress while work is running, (b) reliably retrieve a complete audit
trail when work terminates (including on failure), and (c) compose
multi-step analyses where later tasks consume the outputs of earlier
ones.

## Solution

The workflow engine is extended along five axes:

1. **Task output persistence** — every task records its job's return
   value (or failure message) durably on the task row itself, so
   downstream tasks and the aggregation layer have a single source of
   truth to read from.
2. **Inter-task dependencies** — a task declares which earlier steps it
   depends on; the worker scheduler only runs a task once all its
   declared dependencies have completed successfully; the job receives
   the dependencies' outputs as a context argument.
3. **Fail-fast cascade** — if any task fails, every task that transitively
   depends on it is marked failed without executing; the workflow's
   overall status becomes `failed`.
4. **Framework-owned terminal aggregation** — on any terminal transition
   (`completed` or `failed`), the engine snapshots a full per-task audit
   trail into `Workflow.finalResult`, independent of any user-defined
   report job.
5. **Two new HTTP endpoints** — a live status endpoint (works at any
   workflow state) and a final-results endpoint (serves the snapshot for
   terminal workflows). Both share a single aggregation function and a
   unified response schema.

Clients interact with the system exactly as today (`POST /analysis`) and
additionally via `GET /workflow/:id/status` and `GET /workflow/:id/results`.

## User Stories

1. As an API client, I want to submit a GeoJSON polygon to `POST /analysis`
   and receive a `workflowId`, so that I can reference the workflow in
   subsequent status/result queries.
2. As an API client, I want each workflow to execute its steps
   asynchronously in a background worker, so that my request returns
   promptly with `202 Accepted`.
3. As a workflow author, I want to declare a step of `taskType: polygonArea`
   in YAML, so that the system computes the polygon area in square metres
   from the submitted GeoJSON.
4. As a workflow author, I want the `polygonArea` step to fail the task
   gracefully on invalid GeoJSON with a descriptive error message, so
   that downstream consumers see exactly what was wrong.
5. As a workflow author, I want to declare a step of `taskType: reportGeneration`
   that aggregates outputs of preceding tasks into a single JSON report,
   so that clients receive a human-readable summary.
6. As a workflow author, I want to declare `dependsOn: [stepNumber, ...]`
   in YAML, so that the system waits for those dependencies before
   executing the step.
7. As a workflow author, I want a dependent task to receive its
   dependencies' outputs as an in-memory context argument, so that my
   job code doesn't need to query the database directly.
8. As a workflow author, I want dependent task inputs to survive a
   worker crash and restart, so that resumed workflows still see the
   outputs their deps wrote to disk.
9. As a workflow author, I want a failed task to cascade-fail all its
   transitive dependents without executing them, so that the workflow
   terminates promptly and consistently.
10. As an API client, I want `GET /workflow/:id/status` to return the
    workflow's current status plus completed/total task counts, so that
    I can poll while the workflow is in progress.
11. As an API client, I want `GET /workflow/:id/status?includeTasks=true`
    to additionally return a per-task breakdown, so that I can render a
    detailed progress UI when desired.
12. As an API client, I want `GET /workflow/:id/results` to return the
    workflow's `finalResult` for any terminal state (completed or failed),
    so that I can retrieve the full audit trail regardless of outcome.
13. As an API client, I want `GET /workflow/:id/results` to return
    `400 Bad Request` when the workflow is not yet terminal, so that I
    know to keep polling `/status` instead.
14. As an API client, I want both endpoints to return `404 Not Found` for
    unknown `workflowId`, so that I can distinguish missing resources
    from incomplete ones.
15. As an operator reviewing `finalResult`, I want every task in the
    workflow listed with its `stepNumber`, `taskType`, `status`, and
    either its `output` or `error`, so that I can see exactly where and
    why a workflow failed without cross-referencing other tables.
16. As an operator, I want `finalResult.tasks[]` ordered by `stepNumber`
    ascending, so that I can read the workflow's narrative top-to-bottom.
17. As an operator, I want the worker to recover orphaned
    `in_progress` and `waiting` tasks on startup, so that a crash during
    a task or during the waiting→queued promotion doesn't permanently
    strand work.
18. As an operator inspecting the SQLite file directly, I want
    `Task.dependency` to be human-readable (a JSON array of stepNumbers
    scoped to the workflow), so that I can audit the dependency graph
    without joining back to `tasks` by UUID.
19. As a developer, I want one pure aggregation function to produce the
    response body for both new HTTP endpoints and the persisted
    `finalResult`, so that the three consumers can never drift in shape
    or semantics.
20. As a developer, I want the engine to support multi-input aggregation
    (fan-in) where a single task depends on several predecessors, so
    that `reportGeneration` can consume both `polygonArea` and
    `analysis` outputs in the same workflow.
21. As a reviewer of this submission, I want every non-trivial module
    covered by tests written before the implementation (Red–Green–Refactor),
    so that the correctness claims above are demonstrably upheld.
22. As a reviewer, I want design trade-offs (output column vs. Result
    entity, fail-fast semantics, dependency storage form, results-endpoint
    400 interpretation) documented in the Readme's Design Notes, so that
    I can see what was considered and why.


## Implementation Decisions

### Modules (new and modified)

**New, deep, framework-owned modules** (testable in isolation, simple
interface, durable contract):

- **`workflowSummary` aggregation module.** Pure function. Takes a
  `Workflow` with `tasks` relation loaded and an options object
  `{ includeTasks: boolean }`; returns the unified summary payload used
  by both HTTP endpoints and by `TaskRunner` when it snapshots
  `finalResult`. No I/O, no ORM calls. Single source of schema truth.
- **Reconciliation module.** Invoked once at worker startup before the
  poll loop. Resets `in_progress` tasks to `queued`; promotes any
  `waiting` tasks whose dependencies are all `completed`. No-op in a
  fresh run (acceptable with `dropSchema: true`).

**New jobs** (ordinary `Job` implementations):

- **`PolygonAreaJob`** — `taskType: "polygonArea"`. Parses
  `task.geoJson`, normalises `Polygon` / `Feature<Polygon>` /
  `MultiPolygon`, delegates to `@turf/area`, returns the numeric area in
  square metres. Throws descriptive `Error` on any parse or
  type-validation failure; `TaskRunner`'s existing catch marks the task
  `failed` and captures the message.
- **`ReportGenerationJob`** — `taskType: "reportGeneration"`. Reads
  `context.dependencyOutputs`, shapes the Readme-#2 report (nested
  `tasks[]` array + `finalReport` string), returns the object. Runs
  only on the success path (fail-fast skips it when any upstream task
  failed).

**Modified entities and modules:**

- **`Task`** entity gains: `output: text | null` (stringified JSON of the
  job's return value on completion); `dependency: text | null` (JSON
  array of parent stepNumbers scoped to the same workflow). The legacy
  `resultId` field and the `Result` entity remain untouched to keep the
  diff minimal; see Readme §1 design question.
- **`Workflow`** entity gains: `finalResult: text | null` (stringified
  JSON of the unified summary payload; populated exactly once when the
  workflow reaches a terminal state).
- **`TaskStatus`** enum gains a new `Waiting` variant, representing tasks
  whose declared dependencies are not yet all `Completed`. Five-state
  lifecycle: `Waiting → Queued → InProgress → {Completed | Failed}`.
- **`WorkflowFactory`** parses a `dependsOn` array per step, persists it
  on `Task.dependency`, and sets each task's initial status to `Waiting`
  if its `dependsOn` is non-empty, else `Queued`.
- **`Job`** interface extends to `run(task: Task, context?: JobContext):
  Promise<unknown>`, where `JobContext = { dependencyOutputs:
  Record<number, unknown> }` keyed by parent stepNumber. Existing jobs
  that don't consume the context ignore the second argument — no source
  change required beyond a signature widening.
- **`TaskRunner.run`** gains four responsibilities beyond today's:
  (a) build `JobContext` from parents' persisted `output`,
  (b) within one DB transaction, on task completion, mark dependent
  children `Queued` if all their deps are satisfied; on task failure,
  mark dependent children `Failed` with a skipped-due-to-dep reason
  string,
  (c) on any transition that leaves the workflow terminal, invoke the
  aggregation module and persist `finalResult`,
  (d) write `task.output` alongside the existing `Result` row in the
  same transaction (keeping both in sync, per decision 1).
- **Routes.** A new `workflowRoutes.ts` mounted at `/workflow`, exposing
  `GET /:id/status` and `GET /:id/results`. Existing `/analysis` and
  `/` routes unchanged.
- **`example_workflow.yml`** updated — or a new file added — to
  demonstrate `dependsOn` fan-in (e.g. `reportGeneration` depending on
  both `polygonArea` and `analysis`).


### API contracts

**`GET /workflow/:id/status`** — `200` with
`{ workflowId, status, completedTasks, totalTasks }`; with
`?includeTasks=true`, additionally `tasks: [ ... ]`. `404` if unknown.
`completedTasks` counts tasks whose `status === "completed"` only
(terminal-failed tasks are not counted, by intent).

**`GET /workflow/:id/results`** — `200` with the parsed `finalResult`
payload for any terminal workflow (`completed` or `failed`); `400` if
not yet terminal; `404` if unknown.

### Unified summary schema

`{ workflowId, status, completedTasks, totalTasks, tasks?: [...] }`.
Each entry in `tasks[]` is one of:

- Completed: `{ stepNumber, taskId, taskType, status: "completed", output: <parsed JSON value> }`
- Failed (job threw): `{ stepNumber, taskId, taskType, status: "failed", error: <message> }`
- Failed (skipped by fail-fast cascade): `{ stepNumber, taskId, taskType, status: "failed", error: "Skipped: dependency <stepNumber> failed" }`
- Non-terminal (live `/status?includeTasks=true` only):
  `{ stepNumber, taskId, taskType, status: "waiting" | "queued" | "in_progress", progress?: string }`

`tasks[]` is always present in `finalResult` (full audit trail); it is
absent from the default `/status` response unless `?includeTasks=true`.
Ordering is by `stepNumber` ascending everywhere. Task `output` values
are parsed back from their stringified DB form before inclusion, so
structured outputs round-trip cleanly through the response body.

### Architectural decisions

- **Edge-triggered scheduling, not level-triggered polling.** The worker
  poll query stays `findOne({ where: { status: Queued } })`; readiness
  is an invariant maintained by `TaskRunner` at transitions, not
  re-derived from scratch on every tick.
- **Transactional promotion.** "Parent → completed" and "children →
  queued / failed-cascaded" execute inside a single TypeORM transaction
  via `manager.transaction`. Either both persist or neither does.
- **Startup reconciliation as a safety net** covers the narrow window
  between a successful parent-completion write and a crashed
  promotion — the next worker boot fixes it.
- **Context derived from DB, not memory.** `JobContext.dependencyOutputs`
  is rebuilt from persisted `Task.output` on every `TaskRunner.run`
  invocation, so a restarted task sees the same inputs it would have
  seen before the crash.
- **Framework owns `finalResult`.** A user-authored `ReportGenerationJob`
  is never required for a workflow to have a final result; its output is
  just one of the items nested inside `finalResult.tasks[]`.

### Implementation strategy

**Red–Green–Refactor (TDD), strictly.** For every module listed in
"Testing Decisions" below: write failing tests first, implement the
minimum to make them pass, refactor once green. No implementation code
is to be written before at least one failing test exists for the
behaviour it introduces. PR commit history should reflect this loop.

Recommended sequencing (each step: Red → Green → Refactor before the
next):

1. `workflowSummary` pure aggregation (no DB dependency; fastest loop).
2. `PolygonAreaJob` (pure; covers Todo #1 end-to-end via its own tests).
3. `ReportGenerationJob` (pure; covers Todo #2 shape).
4. `Task` / `Workflow` entity column additions + `WorkflowFactory`
   `dependsOn` persistence (integration; in-memory SQLite).
5. `TaskRunner` transactional promotion + fail-fast cascade +
   `finalResult` persistence (integration).
6. Reconciliation sweep at worker startup (integration; seed stranded
   rows, assert recovery).
7. HTTP routes wired last — trivial adapters over the already-tested
   aggregation module.

## Testing Decisions

**Framework.** `vitest` — runs TypeScript natively, jest-compatible API,
fast cold start, minimal config. Added via `npm install -D vitest`; test
script wired into `package.json`. Tests live under `tests/` mirroring
`src/` layout; default glob (`**/*.test.ts`).

**Modules covered** (all six, by TDD):

1. `workflowSummary` — unit. Varied `Workflow` fixtures: all-completed,
   all-failed, mixed, fail-fast-cascaded, with/without `includeTasks`.
   Asserts shape, ordering by stepNumber, `completedTasks` counting rule.
2. `PolygonAreaJob` — unit. Valid `Feature<Polygon>`, bare `Polygon`,
   `MultiPolygon`; invalid JSON; non-polygon geometry; Readme's example
   polygon (area within tolerance). Asserts throws carry the expected
   message substrings.
3. `ReportGenerationJob` — unit. Multi-dep context, single-dep context,
   dep with `null` output. Asserts report shape matches Readme #2.
4. `WorkflowFactory.createWorkflowFromYAML` — integration (in-memory
   SQLite). YAML with and without `dependsOn`; asserts `Task.dependency`
   persistence and initial `Waiting` / `Queued` status assignment.
5. `TaskRunner.run` — integration (in-memory SQLite). State transitions,
   `Waiting → Queued` promotion on dep completion, fail-fast cascade on
   dep failure, `finalResult` written on terminal transition,
   transactional rollback on mid-transition failure.
6. Reconciliation sweep — integration (in-memory SQLite). Seed DB with
   stranded `in_progress` and orphaned `waiting` rows; run sweep;
   assert recovery.

**Not covered at this stage:** Express route handlers (thin wrappers;
manual curl suffices), `taskWorker` polling loop (the interesting logic
lives in `TaskRunner`), existing `DataAnalysisJob` / `EmailNotificationJob`
(untouched by this PRD).

## Out of Scope

- Duplicate side-effects from retried non-idempotent jobs (e.g. external
  email sends). Jobs are assumed idempotent; at-least-once delivery is
  not mitigated at this stage.
- Distributed / multi-worker execution and lease-based concurrency
  control (Option C from Q4). Current design assumes a single worker
  process; extension path noted in Readme Design Notes.
- Notification on workflow failure (Readme Production Considerations
  callout). `finalResult` carries the per-task failure payload so a
  downstream notifier can be added without schema changes.
- Retry policies, backoff, and dead-letter queues for failed tasks.
- Migrations / schema evolution. The datasource uses `dropSchema: true`;
  production deployments would need TypeORM migrations added.
- Authentication, authorisation, rate limiting on the new endpoints.
- Persisting the `Result` entity contract beyond the legacy fields it
  already holds (see Readme §1 design question).

## Further Notes

- The PRD deliberately leaves the existing `Result` entity and
  `resultId` column on `Task` intact. `Task.output` is the new, durable
  source of truth for per-task job outputs; `Result` is kept for
  backward compatibility with any unseen callers. Rationalising the
  two is a follow-up refactor, not part of this work.
- Per Readme Design Notes, the `400` vs `200` behaviour of
  `/workflow/:id/results` on a *failed* workflow is a deliberate
  interpretation of the spec's phrase "not yet completed" as "not yet
  in a terminal state." A reviewer expecting the strict reading should
  consult that Design Note for the rationale.
- `Task.dependency` stores stepNumbers (not UUIDs) to keep the SQLite
  row human-auditable. In-memory resolution against the already-loaded
  `workflow.tasks` collection makes the lookup O(n) in sibling count,
  which is trivial at this scale.
- The `Waiting` enum value is a five-state extension, not a schema
  break; no migration path is needed because the datasource drops its
  schema on each start.
