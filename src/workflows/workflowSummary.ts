export interface WorkflowSummaryOptions {
  includeTasks: boolean;
}

export interface SummarisableTask {
  taskId: string;
  stepNumber: number;
  taskType: string;
  status: string;
  output?: string | null;
  progress?: string | null;
}

export interface SummarisableWorkflow {
  workflowId: string;
  status: string;
  tasks: SummarisableTask[];
}

export interface CompletedTaskSummary {
  stepNumber: number;
  taskId: string;
  taskType: string;
  status: "completed";
  output: unknown;
}

export interface FailedTaskSummary {
  stepNumber: number;
  taskId: string;
  taskType: string;
  status: "failed";
  error: string;
}

export type NonTerminalStatus = "waiting" | "queued" | "in_progress";

export interface NonTerminalTaskSummary {
  stepNumber: number;
  taskId: string;
  taskType: string;
  status: NonTerminalStatus;
  progress?: string;
}

export type TaskSummary =
  | CompletedTaskSummary
  | FailedTaskSummary
  | NonTerminalTaskSummary;

export interface WorkflowSummary {
  workflowId: string;
  status: string;
  completedTasks: number;
  totalTasks: number;
  tasks?: TaskSummary[];
}

function summariseTask(task: SummarisableTask): TaskSummary {
  const base = {
    stepNumber: task.stepNumber,
    taskId: task.taskId,
    taskType: task.taskType,
  };

  if (task.status === "completed") {
    return {
      ...base,
      status: "completed",
      output: JSON.parse(task.output ?? "null"),
    };
  }

  if (task.status === "failed") {
    return {
      ...base,
      status: "failed",
      error: task.progress ?? "",
    };
  }

  const nonTerminal: NonTerminalTaskSummary = {
    ...base,
    status: task.status as NonTerminalStatus,
  };
  if (task.progress != null) {
    nonTerminal.progress = task.progress;
  }
  return nonTerminal;
}

export function workflowSummary(
  workflow: SummarisableWorkflow,
  options: WorkflowSummaryOptions,
): WorkflowSummary {
  const completedTasks = workflow.tasks.filter(
    t => t.status === "completed",
  ).length;

  const summary: WorkflowSummary = {
    workflowId: workflow.workflowId,
    status: workflow.status,
    completedTasks,
    totalTasks: workflow.tasks.length,
  };

  if (options.includeTasks) {
    summary.tasks = [...workflow.tasks]
      .sort((a, b) => a.stepNumber - b.stepNumber)
      .map(summariseTask);
  }

  return summary;
}
