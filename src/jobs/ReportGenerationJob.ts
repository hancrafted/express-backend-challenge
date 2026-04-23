import { Job, JobContext, JobDependency } from './Job';
import { Task } from '../models/Task';

export interface ReportTaskEntry {
    taskId: string;
    type: string;
    output: unknown;
}

export interface ReportOutput {
    workflowId: string;
    tasks: ReportTaskEntry[];
    finalReport: string;
}

export class ReportGenerationJob implements Job {
    async run(task: Task, context?: JobContext): Promise<ReportOutput> {
        const workflowId = task.workflow?.workflowId ?? '';
        const deps: JobDependency[] = context?.dependencies ?? [];

        const tasks: ReportTaskEntry[] = deps
            .slice()
            .sort((a, b) => a.stepNumber - b.stepNumber)
            .map(d => ({
                taskId: d.taskId,
                type: d.taskType,
                output: d.output,
            }));

        const summaries = tasks.map(t => {
            const outStr =
                t.output === null || t.output === undefined
                    ? 'no output'
                    : typeof t.output === 'string'
                        ? t.output
                        : JSON.stringify(t.output);
            return `${t.type} (${t.taskId}): ${outStr}`;
        });
        const finalReport = summaries.length > 0
            ? `Aggregated ${summaries.length} task${summaries.length === 1 ? '' : 's'}: ${summaries.join('; ')}`
            : 'Aggregated 0 tasks';

        return { workflowId, tasks, finalReport };
    }
}
