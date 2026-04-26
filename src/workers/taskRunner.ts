import { EntityManager, In, Repository } from 'typeorm';
import { Task } from '../models/Task';
import { getJobForTaskType } from '../jobs/JobFactory';
import {WorkflowStatus} from "../workflows/WorkflowFactory";
import {Workflow} from "../models/Workflow";
import {Result} from "../models/Result";
import {JobContext, JobDependency} from "../jobs/Job";
import {workflowSummary} from "../workflows/workflowSummary";

export enum TaskStatus {
    Waiting = 'waiting',
    Queued = 'queued',
    InProgress = 'in_progress',
    Completed = 'completed',
    Failed = 'failed'
}

export class TaskRunner {
    constructor(
        private taskRepository: Repository<Task>,
    ) {}

    /**
     * Runs the appropriate job based on the task's type, managing the task's status.
     * @param task - The task entity that determines which job to run.
     * @throws If the job fails, it rethrows the error.
     */
    async run(task: Task): Promise<void> {
        task.status = TaskStatus.InProgress;
        task.progress = 'starting job...';
        await this.taskRepository.save(task);
        const job = getJobForTaskType(task.taskType);

        try {
            const context = await this.buildJobContext(task);
            console.log(`Starting job ${task.taskType} for task ${task.taskId}...`);
            const taskResult = await job.run(task, context);
            console.log(`Job ${task.taskType} for task ${task.taskId} completed successfully.`);

            await this.taskRepository.manager.transaction(async (tx) => {
                const txTaskRepo = tx.getRepository(Task);
                const txResultRepo = tx.getRepository(Result);

                const result = new Result();
                result.taskId = task.taskId!;
                result.data = JSON.stringify(taskResult || {});
                await txResultRepo.save(result);
                task.resultId = result.resultId!;
                task.status = TaskStatus.Completed;
                task.progress = null;
                task.output = JSON.stringify(taskResult ?? null);
                await txTaskRepo.save(task);

                const siblings = await txTaskRepo.find({
                    where: { workflow: { workflowId: task.workflow.workflowId }, status: TaskStatus.Waiting },
                    relations: ['workflow'],
                });
                if (siblings.length > 0) {
                    const completedSteps = new Set<number>();
                    const allTasks = await txTaskRepo.find({
                        where: { workflow: { workflowId: task.workflow.workflowId } },
                        relations: ['workflow'],
                    });
                    for (const t of allTasks) {
                        if (t.status === TaskStatus.Completed) completedSteps.add(t.stepNumber);
                    }
                    for (const sibling of siblings) {
                        const deps: number[] = sibling.dependency ? JSON.parse(sibling.dependency) : [];
                        if (deps.length > 0 && deps.every(d => completedSteps.has(d))) {
                            sibling.status = TaskStatus.Queued;
                            await txTaskRepo.save(sibling);
                        }
                    }
                }

                await this.updateWorkflowStatus(tx, task.workflow.workflowId);
            });

        } catch (error: any) {
            console.error(`Error running job ${task.taskType} for task ${task.taskId}:`, error);

            await this.taskRepository.manager.transaction(async (tx) => {
                const txTaskRepo = tx.getRepository(Task);

                task.status = TaskStatus.Failed;
                task.progress = null;
                task.error = error?.message ?? String(error);
                await txTaskRepo.save(task);

                const allTasks = await txTaskRepo.find({
                    where: { workflow: { workflowId: task.workflow.workflowId } },
                    relations: ['workflow'],
                });

                const failedSteps = new Set<number>();
                for (const t of allTasks) {
                    if (t.status === TaskStatus.Failed) failedSteps.add(t.stepNumber);
                }

                const queue: number[] = [task.stepNumber];
                const cascaded = new Set<number>();
                while (queue.length > 0) {
                    const parentStep = queue.shift()!;
                    for (const candidate of allTasks) {
                        if (candidate.stepNumber === parentStep) continue;
                        if (cascaded.has(candidate.stepNumber)) continue;
                        if (candidate.taskId === task.taskId) continue;
                        if (candidate.status === TaskStatus.Completed || candidate.status === TaskStatus.Failed) continue;
                        const deps: number[] = candidate.dependency
                            ? JSON.parse(candidate.dependency)
                            : [];
                        if (!deps.includes(parentStep)) continue;

                        const failedDepSteps = deps
                            .filter(d => failedSteps.has(d) || d === task.stepNumber || cascaded.has(d))
                            .sort((a, b) => a - b);
                        const reasonStep = failedDepSteps[0] ?? parentStep;

                        candidate.status = TaskStatus.Failed;
                        candidate.progress = null;
                        candidate.error = `Skipped: dependency ${reasonStep} failed`;
                        await txTaskRepo.save(candidate);

                        cascaded.add(candidate.stepNumber);
                        queue.push(candidate.stepNumber);
                    }
                }

                await this.updateWorkflowStatus(tx, task.workflow.workflowId);
            });

            throw error;
        }
    }

    private async updateWorkflowStatus(tx: EntityManager, workflowId: string): Promise<void> {
        const workflowRepository = tx.getRepository(Workflow);
        const currentWorkflow = await workflowRepository.findOne({ where: { workflowId }, relations: ['tasks'] });

        if (currentWorkflow) {
            const allCompleted = currentWorkflow.tasks.every(t => t.status === TaskStatus.Completed);
            const anyFailed = currentWorkflow.tasks.some(t => t.status === TaskStatus.Failed);

            if (anyFailed) {
                currentWorkflow.status = WorkflowStatus.Failed;
            } else if (allCompleted) {
                currentWorkflow.status = WorkflowStatus.Completed;
            } else {
                currentWorkflow.status = WorkflowStatus.InProgress;
            }

            const isTerminal =
                currentWorkflow.status === WorkflowStatus.Completed ||
                currentWorkflow.status === WorkflowStatus.Failed;
            if (isTerminal && !currentWorkflow.finalResult) {
                currentWorkflow.finalResult = JSON.stringify(
                    workflowSummary(currentWorkflow, { includeTasks: true }),
                );
            }

            await workflowRepository.save(currentWorkflow);
        }
    }

    private async buildJobContext(task: Task): Promise<JobContext | undefined> {
        if (!task.dependency) {
            return undefined;
        }
        let deps: number[];
        try {
            deps = JSON.parse(task.dependency);
        } catch (err: any) {
            throw new Error(`Invalid Task.dependency JSON: ${err?.message ?? err}`);
        }
        if (!Array.isArray(deps) || deps.length === 0) {
            return undefined;
        }

        const workflowId = task.workflow?.workflowId;
        if (!workflowId) {
            return { dependencyOutputs: {}, dependencies: [] };
        }

        const parents = await this.taskRepository.find({
            where: {
                workflow: { workflowId },
                stepNumber: In(deps),
            },
            relations: ['workflow'],
        });

        const dependencyOutputs: Record<number, unknown> = {};
        const dependencies: JobDependency[] = [];
        for (const step of deps) {
            dependencyOutputs[step] = null;
        }
        for (const parent of parents) {
            let parsed: unknown = null;
            if (parent.output !== null && parent.output !== undefined) {
                try {
                    parsed = JSON.parse(parent.output);
                } catch {
                    parsed = parent.output;
                }
            }
            dependencyOutputs[parent.stepNumber] = parsed;
            dependencies.push({
                stepNumber: parent.stepNumber,
                taskId: parent.taskId,
                taskType: parent.taskType,
                output: parsed,
            });
        }
        dependencies.sort((a, b) => a.stepNumber - b.stepNumber);
        return { dependencyOutputs, dependencies };
    }
}