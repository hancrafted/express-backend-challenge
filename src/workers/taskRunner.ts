import { Repository } from 'typeorm';
import { Task } from '../models/Task';
import { getJobForTaskType } from '../jobs/JobFactory';
import {WorkflowStatus} from "../workflows/WorkflowFactory";
import {Workflow} from "../models/Workflow";
import {Result} from "../models/Result";

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
            console.log(`Starting job ${task.taskType} for task ${task.taskId}...`);
            const taskResult = await job.run(task);
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
            });

        } catch (error: any) {
            console.error(`Error running job ${task.taskType} for task ${task.taskId}:`, error);

            task.status = TaskStatus.Failed;
            task.progress = null;
            await this.taskRepository.save(task);

            throw error;
        }

        const workflowRepository = this.taskRepository.manager.getRepository(Workflow);
        const currentWorkflow = await workflowRepository.findOne({ where: { workflowId: task.workflow.workflowId }, relations: ['tasks'] });

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

            await workflowRepository.save(currentWorkflow);
        }
    }
}