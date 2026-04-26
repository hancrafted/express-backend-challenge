# TESTING_PRD — Test-Coverage PRD for Workflow Engine Enhancements

> Synthesised against `PRD.md` (the implementation spec) and the
> existing `tests/` tree (13 test files, ~50 cases). Produced via the
> `to-prd` skill (synthesis-only) with the `grill-me` skill applied
> against the codebase rather than the user — every coverage question
> answerable by reading `tests/` and `src/` was resolved that way.
> The output is therefore a gap-driven PRD: which behaviours required
> by `PRD.md` and `README.md` are demonstrably exercised, which are
> not, and what needs adding to close the difference.

## Problem Statement

As a reviewer of this submission, I cannot tell from the existing
`tests/` directory alone whether the workflow engine actually
satisfies all 22 user stories captured in `PRD.md` — only that the
**happy-path shape** of each module is exercised. In particular:

- **Happy paths dominate.** Most failing-input branches in
  `PolygonAreaJob`, `WorkflowFactory`, and `TaskRunner` have one
  representative test each, and several have none.
- **Error paths are thin.** Malformed YAML, malformed
  `Task.dependency` JSON, unknown `taskType`, missing/empty
  `geoJson`, missing `finalResult` on a terminal workflow, and
  non-boolean `?includeTasks` query values are all unverified.
- **Edge cases on graph topology are uncovered.** Tests exercise
  linear chains and 1-level fan-in / 1-level diamonds only. There
  is no test for deep dependency chains, wide fan-out, fan-in
  beyond two parents, or DAGs with multiple distinct failure
  origins propagating concurrently.
- **No extreme/scale tests.** The user-requested "workflow with
  100 tasks and multiple dependencies" scenario is not present in
  any form — neither at `WorkflowFactory`, `TaskRunner`, nor
  aggregation level.
- **End-to-end coverage is one happy path.** The single
  `tests/integration/fanInWorkflow.test.ts` test covers only the
  three-step success scenario. There is no E2E for cascaded
  failure, partial-progress polling, or crash recovery via the
  reconciliation sweep.
- **Workflow status transition semantics** (`Initial → InProgress`
  on first task start; staying `InProgress` while non-terminal)
  are implicitly relied upon but not asserted.

The user-facing risk is that a regression in any of the above
branches could ship without any red test.

## Solution

Extend the existing `tests/` tree along four axes, mirroring the
existing layout (`tests/jobs`, `tests/workflows`, `tests/workers`,
`tests/routes`, `tests/integration`) and using the same Vitest +
in-memory-SQLite + Supertest stack already in place. The four axes
are: **happy-path completeness**, **error-path coverage**, **graph
edge cases**, and **extreme/scale scenarios**. No production code
changes — this PRD covers only additional or extended tests, plus
the minimum test-helper extraction needed to keep the new tests
readable.

The deliverable is a coverage matrix that one-to-one maps each
of the 22 user stories in `PRD.md` to at least one happy-path
test, at least one negative test where applicable, and an explicit
extreme-scale test for any module whose correctness is sensitive to
graph size or shape.

## User Stories

The list is grouped by `PRD.md` user-story coverage; each entry
states the testing intent in PRD form (`As a … I want … so that …`).
Entries marked **(existing)** are already satisfied by the current
tests folder and are listed for traceability; **(gap)** entries are
the new tests this PRD proposes.

### Happy-path coverage (per existing PRD user story)

1. **(existing — partial)** As a reviewer, I want
   `PolygonAreaJob` exercised against `Feature<Polygon>`, bare
   `Polygon`, and `MultiPolygon` inputs, so that all three GeoJSON
   variants the spec accepts are demonstrably handled. *Currently
   in `tests/jobs/PolygonAreaJob.test.ts`.*
2. **(existing)** As a reviewer, I want
   `ReportGenerationJob` exercised on single-dep, fan-in, and
   `null`-output dependencies, so that all three input shapes the
   spec calls out are demonstrably handled.
3. **(existing)** As a reviewer, I want `workflowSummary`
   exercised on completed-only, all-failed, mixed, cascade-skipped,
   and non-terminal workflows, so that the unified-summary
   contract holds for every workflow lifecycle state.
4. **(existing)** As a reviewer, I want `WorkflowFactory` to
   parse `dependsOn` correctly on YAML with and without
   dependencies, so that initial `Waiting`/`Queued` status
   assignment is verified.
5. **(existing)** As a reviewer, I want `TaskRunner`'s waiting
   → queued promotion exercised on single-parent and multi-parent
   children, so that the readiness invariant is upheld.
6. **(existing)** As a reviewer, I want `TaskRunner`'s fail-fast
   cascade exercised at single-level, multi-level, and diamond
   topologies, so that transitive cascade is demonstrably correct.
7. **(existing)** As a reviewer, I want `TaskRunner`'s
   `JobContext` build exercised on no-deps, single-parent,
   fan-in, and `null`-output parent, so that downstream jobs
   receive the inputs the spec promises.
8. **(existing)** As a reviewer, I want `TaskRunner.finalResult`
   written on both completed-terminal and failed-terminal
   transitions and **not** mid-run, so that the framework-owned
   audit-trail contract is verified.
9. **(existing)** As a reviewer, I want `reconcileTasks` exercised
   on stranded `InProgress`, single-parent promotion,
   mixed-parents non-promotion, and `Failed`-parent
   non-promotion, so that startup recovery is correct.
10. **(existing)** As a reviewer, I want `GET /workflow/:id/status`
    and `GET /workflow/:id/results` exercised on `200` /
    `400` / `404` and on `?includeTasks=true`, so that the HTTP
    surface conforms to the spec.
11. **(existing — partial)** As a reviewer, I want one
    end-to-end happy-path test that drives the full fan-in
    workflow from YAML through HTTP, so that the modules
    integrate as designed. *Currently in
    `tests/integration/fanInWorkflow.test.ts`.*

### Error-path coverage (gaps)

12. **(gap)** As a reviewer, I want `PolygonAreaJob` to reject
    `Polygon` rings with fewer than four coordinates, an
    explicitly unclosed ring, and `null`/empty `task.geoJson`,
    so that turf-internal "soft-success" cases (e.g. zero-area
    output) cannot silently pass through.
13. **(gap)** As a reviewer, I want `PolygonAreaJob` to reject
    a syntactically valid GeoJSON `FeatureCollection` (which
    `@turf/area` accepts but the spec does not), so that the
    job's documented contract — Polygon / Feature<Polygon> /
    MultiPolygon only — is enforced.
14. **(gap)** As a reviewer, I want `ReportGenerationJob` to
    handle being invoked with `context === undefined` and
    with `context.dependencyOutputs === {}`, so that a YAML
    misconfiguration (a `reportGeneration` step without
    `dependsOn`) fails predictably rather than crashing.
15. **(gap)** As a reviewer, I want `JobFactory.getJobForTaskType`
    exercised on every `taskType` declared in
    `example_workflow.yml` (`polygonArea`, `analysis`,
    `reportGeneration`, `notification`) plus an unknown
    `taskType`, so that route-able task types are guaranteed
    resolvable and unknown ones produce a deterministic
    failure mode (throw or a sentinel job that fails the
    task).
16. **(gap)** As a reviewer, I want `WorkflowFactory` to reject
    YAML with: missing `steps`; a `dependsOn` referencing a
    non-existent `stepNumber`; duplicate `stepNumber`s; and a
    cyclic dependency graph, so that submit-time validation
    failures are caught before tasks land in the queue. *(Note:
    `PRD.md` Production Considerations explicitly defers
    cycle/duplicate validation; this user story records that
    the test suite should at minimum **document the current
    permissive behaviour** — i.e. assert that today these YAMLs
    do not throw — so a future tightening is observable.)*
17. **(gap)** As a reviewer, I want `TaskRunner` to behave
    deterministically when `Task.dependency` contains malformed
    JSON (a corrupted DB row), so that the worker fails the
    task rather than silently treating it as no-deps.
18. **(gap)** As a reviewer, I want `TaskRunner` to behave
    deterministically when invoked on a task whose workflow is
    already `Completed`/`Failed`, so that idempotent
    re-invocation cannot overwrite `finalResult` or re-run a
    completed task's job side-effects.
19. **(gap)** As a reviewer, I want `GET /workflow/:id/results`
    to return `500` (or another deterministic non-200) when the
    workflow is in a terminal state but `finalResult` is `null`
    (DB inconsistency), so that the route contract is
    well-defined for every persisted state, not only the
    happy path.
20. **(gap)** As a reviewer, I want `GET /workflow/:id/status`
    to coerce or validate `?includeTasks` deterministically for
    values other than the literal `"true"` (e.g. `"1"`,
    `"TRUE"`, `""`, an array, omitted), so that a polling
    client cannot accidentally toggle the verbose payload.
21. **(gap)** As a reviewer, I want the routes verified for
    workflows with **zero tasks** (an edge artefact of an
    empty YAML), so that the divisor-style fields
    (`completedTasks`, `totalTasks`) and `tasks[]` ordering do
    not fault.

### Graph / edge-case coverage (gaps)

22. **(gap)** As a reviewer, I want `TaskRunner`'s waiting →
    queued promotion exercised on **transitive** chains
    (A → B → C → D linear), so that the in-transaction sweep
    cascades readiness correctly across more than two layers.
23. **(gap)** As a reviewer, I want `TaskRunner`'s cascade
    exercised on **wide fan-out** (one failed parent with
    ≥ 10 dependents, no transitive depth), so that the BFS
    cascade visits every dependent in one pass.
24. **(gap)** As a reviewer, I want `TaskRunner`'s cascade
    exercised on **wide fan-in** (≥ 5 parents → 1 child) where
    one parent fails late, so that the child is cascaded
    exactly once regardless of which parent fails first.
25. **(gap)** As a reviewer, I want a workflow where
    **two independent failure origins** propagate concurrently
    into a shared descendant, so that the cascade reason
    string is deterministic (lowest-stepNumber failed
    dependency) and the dependent is failed exactly once.
26. **(gap)** As a reviewer, I want `reconcileTasks` exercised
    on a **chain** of `Waiting` tasks where the topmost
    parent is already `Completed`, so that a single sweep
    promotes the chain transitively (or, if the spec is
    "one level per sweep", that property is asserted explicitly).
27. **(gap)** As a reviewer, I want `reconcileTasks` exercised
    on a workflow with both stranded `InProgress` rows and
    promotable `Waiting` rows in the **same** sweep, ordered
    such that resetting an `InProgress` parent does **not**
    accidentally promote its `Waiting` child (because reset
    parents are no longer `Completed`). Currently absent;
    `PRD.md` Cross-cutting §"Crash recovery" implies this case.
28. **(gap)** As a reviewer, I want `workflowSummary` to
    handle a workflow whose `tasks` relation contains tasks
    spanning **all five** terminal/non-terminal statuses
    simultaneously, so that the live-status path mid-flight
    is shape-stable.
29. **(gap)** As a reviewer, I want `WorkflowFactory` to handle
    a YAML where steps are listed **out of stepNumber order**
    (e.g. `[3, 1, 2]`), so that ordering is a property of
    `stepNumber` not file position.

### Extreme / scale coverage (gaps)

30. **(gap)** As a reviewer, I want a `WorkflowFactory` test
    that loads a YAML with **100 steps** and a non-trivial
    dependency graph (e.g. linear chain + a fan-in spine), so
    that parse-time and persist-time scaling is observed and
    `Task.dependency` JSON survives at scale.
31. **(gap)** As a reviewer, I want a `TaskRunner` integration
    test that drains a **100-task fan-in workflow** (e.g.
    99 parallel leaves → 1 aggregator) to terminal completion
    via the worker drain pattern from
    `tests/integration/fanInWorkflow.test.ts`, so that the
    in-transaction promotion sweep does not regress when the
    `siblings` and `allTasks` lists are large.
32. **(gap)** As a reviewer, I want a `TaskRunner` integration
    test where one of the leaves of a **100-task wide fan-in**
    fails, so that BFS cascade reaches all transitive
    dependents at scale and `finalResult` is well-formed
    (every task accounted for, ordered by `stepNumber`).
33. **(gap)** As a reviewer, I want a `TaskRunner` test on a
    **deep linear chain** (e.g. 50 tasks A → B → C → … with
    one dependency each), so that promotion latency stays
    bounded (no quadratic re-scan regressions) and every step
    transitions exactly `Waiting → Queued → InProgress →
    Completed`.
34. **(gap)** As a reviewer, I want `workflowSummary`
    exercised on a 100-task workflow with mixed terminal and
    non-terminal statuses, so that `tasks[]` ordering is
    correct under volume and `completedTasks` counts agree
    with a manual scan.
35. **(gap)** As a reviewer, I want `GET
    /workflow/:id/status?includeTasks=true` measured against a
    100-task workflow (response shape and ordering only — no
    perf SLA at this stage), so that the route does not
    truncate, paginate implicitly, or reorder under volume.

### End-to-end / integration coverage (gaps)

36. **(gap)** As a reviewer, I want an integration test that
    submits a workflow whose first step receives **invalid
    GeoJSON**, drains the queue, and then asserts the HTTP
    surface (`/status`, `/results`) reflects the failure end
    to end (status `failed`, `finalResult.tasks[*].error`
    populated), so that the happy-path E2E test is balanced
    by a failure-path E2E.
37. **(gap)** As a reviewer, I want an integration test that
    polls `GET /workflow/:id/status` mid-drain (i.e. after
    `parent.run()` and before `child.run()`) and asserts
    `status === "in_progress"`, `completedTasks === 1`,
    `totalTasks === 3`, so that the live-status endpoint is
    verified during a non-terminal state — currently only
    terminal-state status is integration-tested.
38. **(gap)** As a reviewer, I want an integration test that
    simulates a worker crash by leaving a task `InProgress`
    in the DB, runs `reconcileTasks`, then continues draining,
    and asserts the workflow still reaches `Completed`, so
    that the reconciliation sweep is integration-verified
    against the same E2E pipeline rather than only in
    isolation.

### Cross-cutting properties (gaps)

39. **(gap)** As a reviewer, I want `Workflow.status` asserted
    to transition `Initial → InProgress` on the first
    `TaskRunner.run`, so that the lifecycle entry point is
    not implicit.
40. **(gap)** As a reviewer, I want `TaskRunner` asserted to
    write **both** `Result.data` (legacy) and `Task.output`
    (new canonical) atomically on success, so that the
    deliberate dual-write decision (PRD §Modules) is locked
    in by a regression test.
41. **(gap)** As a reviewer, I want `TaskRunner` asserted to
    leave `Task.output` `null` (or untouched) on the failure
    path, so that downstream `JobContext` builders cannot
    consume a stale partial output.

## Implementation Decisions

### Test files to add or extend

Mirror the existing `tests/` layout — do not introduce new top-level
folders. New test files only where the existing file would otherwise
exceed ~250 lines or cover a clearly distinct module behaviour.

- **`tests/jobs/PolygonAreaJob.test.ts`** — extend with stories 12, 13.
- **`tests/jobs/ReportGenerationJob.test.ts`** — extend with story 14.
- **`tests/jobs/JobFactory.test.ts`** — extend with story 15 (full
  taskType coverage + unknown taskType).
- **`tests/workflows/WorkflowFactory.deps.test.ts`** — extend with
  stories 16, 29.
- **`tests/workflows/WorkflowFactory.scale.test.ts`** *(new)* —
  story 30.
- **`tests/workflows/workflowSummary.test.ts`** — extend with
  stories 28, 34.
- **`tests/workers/taskRunner.errorPath.test.ts`** *(new)* —
  stories 17, 18, 41.
- **`tests/workers/taskRunner.promotion.test.ts`** — extend with
  story 22.
- **`tests/workers/taskRunner.cascade.test.ts`** — extend with
  stories 23, 24, 25.
- **`tests/workers/taskRunner.lifecycle.test.ts`** *(new)* —
  stories 39, 40.
- **`tests/workers/reconciliation.test.ts`** — extend with
  stories 26, 27.
- **`tests/workers/taskRunner.scale.test.ts`** *(new)* —
  stories 31, 32, 33.
- **`tests/routes/workflowRoutes.test.ts`** — extend with
  stories 19, 20, 21, 35.
- **`tests/integration/cascadeWorkflow.test.ts`** *(new)* —
  story 36.
- **`tests/integration/midDrainStatus.test.ts`** *(new)* —
  story 37.
- **`tests/integration/reconciliationE2E.test.ts`** *(new)* —
  story 38.

### Test helpers

Three small helpers are extracted to avoid duplicating the
~30-line setup boilerplate that is currently copy-pasted across
six worker tests. Helpers live in `tests/_support/` (new
underscore-prefixed folder so it is filtered out of the default
test glob) and contain only setup utilities — no assertions.

- `makeDataSource()` — returns the configured in-memory
  TypeORM `DataSource`, identical to today's
  `beforeEach`-inlined version.
- `seedWorkflow(ds, overrides?)` — saves and returns a
  `Workflow` row.
- `makeTask(workflow, stepNumber, status, opts?)` — the
  signature already used in five files, lifted as-is.

The new scale-tests use one further helper, `buildLinearChainYaml(n)`
and `buildFanInYaml(n)`, that emit YAML strings consumed by
`WorkflowFactory.createWorkflowFromYAML` from a temp file.

### Test-runner configuration

No changes to `package.json` scripts. Vitest's default glob
already picks up the new files. Per `CLAUDE.md`, every commit
MUST run `npm test`; the new scale tests are kept under 2s wall
clock at 100 tasks (in-memory SQLite + no I/O) so the full
suite stays under the existing CI budget.

### What makes a good test here

- **External behaviour only.** Tests assert observable state
  (DB rows, HTTP responses, function return values), never
  private fields or call counts on internals. Existing
  `vi.spyOn(taskRepo.manager, "transaction")` calls in
  `taskRunner.cascade.test.ts` and `taskRunner.promotion.test.ts`
  are the deliberate exception, locking in the
  "transactional promotion" architectural decision from the
  source PRD; this PRD proposes no new spies.
- **One assertion focus per `it`.** Mirror the existing
  granularity — every existing test makes one or two related
  claims, never bundles three unrelated ones.
- **Reuse fixtures from existing tests.** The Readme polygon
  GeoJSON, the `validGeoJson`/`invalidGeoJson` constants, and
  the `makeTask` helper shape are already established and
  should be reused verbatim where applicable.
- **Prior art.** The closest exemplars to follow per category
  are: `taskRunner.cascade.test.ts` for graph-shape tests,
  `tests/integration/fanInWorkflow.test.ts` for E2E (its
  `drainQueuedTasks` helper is the canonical pattern and
  should be reused — likely lifted into `tests/_support`),
  `workflowSummary.test.ts` for pure-aggregation
  data-driven cases, and `routes/workflowRoutes.test.ts`
  for HTTP coverage with `supertest`.

### Coverage matrix (PRD user story → test file)

| `PRD.md` US | Happy | Negative | Edge / Extreme |
|---|---|---|---|
| 1 (POST /analysis) | *(out of scope; existing route)* | — | — |
| 2 (async 202) | *(out of scope; existing route)* | — | — |
| 3 (polygonArea) | jobs/PolygonAreaJob.test (existing) | jobs/PolygonAreaJob.test (story 12) | — |
| 4 (graceful failure on invalid GeoJSON) | jobs/PolygonAreaJob.test (existing) | jobs/PolygonAreaJob.test (story 13) | — |
| 5 (reportGeneration) | jobs/ReportGenerationJob.test (existing) | jobs/ReportGenerationJob.test (story 14) | — |
| 6 (dependsOn YAML) | workflows/WorkflowFactory.deps.test (existing) | workflows/WorkflowFactory.deps.test (story 16) | workflows/WorkflowFactory.deps.test (story 29), workflows/WorkflowFactory.scale.test (story 30) |
| 7 (job context) | workers/taskRunner.context.test (existing) | workers/taskRunner.errorPath.test (story 17) | — |
| 8 (deps survive crash) | workers/reconciliation.test (existing) | — | integration/reconciliationE2E.test (story 38) |
| 9 (fail-fast cascade) | workers/taskRunner.cascade.test (existing) | — | workers/taskRunner.cascade.test (stories 23, 24, 25), workers/taskRunner.scale.test (story 32) |
| 10 (GET /status) | routes/workflowRoutes.test (existing) | routes/workflowRoutes.test (stories 20, 21) | routes/workflowRoutes.test (story 35) |
| 11 (?includeTasks=true) | routes/workflowRoutes.test (existing) | routes/workflowRoutes.test (story 20) | — |
| 12 (GET /results terminal) | routes/workflowRoutes.test (existing) | routes/workflowRoutes.test (story 19) | — |
| 13 (400 non-terminal) | routes/workflowRoutes.test (existing) | — | — |
| 14 (404 unknown) | routes/workflowRoutes.test (existing) | — | — |
| 15 (every task in finalResult) | workers/taskRunner.finalResult.test (existing) | — | workers/taskRunner.scale.test (story 32) |
| 16 (ordered by stepNumber) | workflows/workflowSummary.test (existing) | — | workflows/workflowSummary.test (story 34) |
| 17 (reconciliation) | workers/reconciliation.test (existing) | — | workers/reconciliation.test (stories 26, 27), integration/reconciliationE2E.test (story 38) |
| 18 (Task.dependency JSON form) | workflows/WorkflowFactory.deps.test (existing) | workers/taskRunner.errorPath.test (story 17) | — |
| 19 (single aggregation function) | workflows/workflowSummary.test (existing) | — | workflows/workflowSummary.test (stories 28, 34) |
| 20 (multi-input fan-in) | workers/taskRunner.context.test (existing) | — | workers/taskRunner.cascade.test (story 24), workers/taskRunner.scale.test (stories 31, 32) |
| 21 (TDD) | *(process; not testable)* | — | — |
| 22 (Design Notes) | *(process; not testable)* | — | — |

## Testing Decisions

- **Tests assert externally observable behaviour only.** The new
  tests claim DB rows, HTTP response bodies, function return
  values, and (for end-to-end tests) the converged terminal
  state of the worker. They do not introspect TypeORM
  internals, transaction objects, or job-class private state.
- **No mocking of TypeORM beyond the existing `vi.mock` of
  `JobFactory` already used in `taskRunner.context.test.ts`.**
  In-memory SQLite is fast enough that real persistence is the
  default in every new test.
- **Scale tests cap at 100 tasks.** This matches the user's
  stated extreme scenario and stays within Vitest's default
  per-test 5s budget on in-memory SQLite. No perf-regression
  thresholds (wall-clock assertions) are introduced — only
  correctness at scale.
- **Shared-state hygiene.** Every new test follows the existing
  `beforeEach` / `afterEach` pattern: a fresh in-memory
  `DataSource` with `dropSchema: true`. No test reuses a
  database across cases.
- **Worker-loop draining via the inlined helper from
  `tests/integration/fanInWorkflow.test.ts`.** Promote that
  function into `tests/_support/drainQueuedTasks.ts` so the
  three new integration tests (cascade, mid-drain, recovery)
  can reuse it.

## Out of Scope

- **Performance / latency thresholds.** Wall-clock SLAs and
  throughput numbers are explicitly out — only correctness at
  scale is asserted. `PRD.md` Production Considerations §
  "Scheduler scale ceiling" is the upstream reason: anything
  beyond ~10⁴ workflows/day is a `Temporal` migration, not a
  test.
- **Concurrency / race tests across multiple workers.** Per
  `PRD.md` Out-of-Scope §"Distributed / multi-worker
  execution", the engine assumes a single worker. No race
  tests against `findOne({ status: Queued })`.
- **Authentication, authorisation, rate-limiting tests.** All
  three are explicitly listed as out-of-scope in `PRD.md`.
- **`POST /analysis` regression coverage.** The existing
  pre-PRD route was untouched and remains untested in this
  repo's test tree; covering it is a separate scope.
- **Mutation testing / property-based testing.** Enumeration
  of cases is sufficient at this scale; introducing
  `fast-check` or Stryker is out of scope for this PRD.
- **Migrations / schema-evolution tests.** `dropSchema: true`
  is a deliberate dev-mode choice per `PRD.md`; tests do not
  exercise migration paths.
- **`DataAnalysisJob` and `EmailNotificationJob` unit tests.**
  Both are pre-existing example jobs untouched by this PRD,
  excluded by `PRD.md` Testing Decisions §"Not covered at
  this stage."

## Further Notes

- **Documenting the current permissive behaviour matters** in
  story 16 (cycle / duplicate / dangling-dep YAML). The point
  of the test is not to enforce validation today but to make
  the absence of validation observable, so a future commit
  that *adds* it will see the test break and have to be
  intentional about it. This is a load-bearing pattern for
  the "Production Considerations Considered, Deferred" list
  in `README.md`.
- **The `reconciliation` chain story (26)** is intentionally
  written so that whichever sweep strategy ships — single-pass
  one-level vs. fixed-point — is locked in by the test. The
  current `src/workers/reconciliation.ts` should be inspected
  to determine which behaviour holds, and the test should
  pin **that** behaviour, not the spec-author's preference.
- **The deliberate dual-write of `Result` and `Task.output`**
  (story 40) is currently observable only indirectly; the
  proposed test makes it the explicit lock for `PRD.md`
  §Further Notes "leaves the existing `Result` entity …
  intact". A future cleanup that drops `Result` will need to
  retire this test alongside the entity removal — the test
  is a deliberate marker, not a permanent fixture.
- **The `taskRunner.errorPath` malformed-`dependency` test
  (story 17)** complements the source's defensive
  `JSON.parse` `try/catch` in `buildJobContext`. The intent
  is to assert that a corrupted DB row produces a determinate
  failure rather than coincidentally running the task
  no-deps; if the source code currently swallows the error,
  the test will surface that and trigger a follow-up.
- **Submitting this PRD as a GitHub issue** — the `to-prd`
  skill template recommends doing so. The user requested a
  file rather than an issue, so this lives at
  `TESTING_PRD.md` in the repo root alongside `PRD.md`.
  Promotion to a GitHub issue (or splitting into per-test-file
  issues via the companion `to-issues` skill) is a follow-up
  the user may invoke separately.
