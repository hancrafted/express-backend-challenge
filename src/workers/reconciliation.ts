import { DataSource } from 'typeorm';
import { Task } from '../models/Task';
import { TaskStatus } from './taskRunner';

export async function reconcileTasks(
    dataSource: DataSource,
): Promise<{ reset: number; promoted: number }> {
    const taskRepository = dataSource.getRepository(Task);

    const stranded = await taskRepository.find({ where: { status: TaskStatus.InProgress } });
    for (const task of stranded) {
        task.status = TaskStatus.Queued;
        task.progress = null;
        await taskRepository.save(task);
    }

    const waiting = await taskRepository.find({
        where: { status: TaskStatus.Waiting },
        relations: ['workflow'],
    });
    let promoted = 0;
    for (const task of waiting) {
        const deps: number[] = task.dependency ? JSON.parse(task.dependency) : [];
        if (deps.length === 0) continue;
        const workflowId = task.workflow?.workflowId;
        if (!workflowId) continue;
        const siblings = await taskRepository.find({
            where: { workflow: { workflowId } },
            relations: ['workflow'],
        });
        const completedSteps = new Set<number>();
        for (const sibling of siblings) {
            if (sibling.status === TaskStatus.Completed) completedSteps.add(sibling.stepNumber);
        }
        if (deps.every(d => completedSteps.has(d))) {
            task.status = TaskStatus.Queued;
            await taskRepository.save(task);
            promoted++;
        }
    }

    return { reset: stranded.length, promoted };
}
