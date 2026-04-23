import {Task} from "../models/Task";

export interface JobContext {
    dependencyOutputs: Record<number, unknown>;
}

export interface Job {
    run(task: Task, context?: JobContext): Promise<any>;
}