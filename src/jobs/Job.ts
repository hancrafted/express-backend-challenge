import {Task} from "../models/Task";

export interface JobDependency {
    stepNumber: number;
    taskId: string;
    taskType: string;
    output: unknown;
}

export interface JobContext {
    dependencyOutputs: Record<number, unknown>;
    dependencies?: JobDependency[];
}

export interface Job {
    run(task: Task, context?: JobContext): Promise<any>;
}