import { Router } from 'express';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { Workflow } from '../models/Workflow';
import { workflowSummary } from '../workflows/workflowSummary';
import { WorkflowStatus } from './../workflows/WorkflowFactory';

export function createWorkflowRouter(dataSource: DataSource): Router {
    const router = Router();
    const workflowRepository = dataSource.getRepository(Workflow);

    router.get('/:id/status', async (req, res) => {
        const workflow = await workflowRepository.findOne({
            where: { workflowId: req.params.id },
            relations: ['tasks'],
        });

        if (!workflow) {
            res.status(404).json({ message: 'Workflow not found' });
            return;
        }

        const summary = workflowSummary(workflow, {
            includeTasks: req.query.includeTasks === 'true',
        });

        res.status(200).json(summary);
    });

    router.get('/:id/results', async (req, res) => {
        const workflow = await workflowRepository.findOneBy({ workflowId: req.params.id });

        if (!workflow) {
            res.status(404).json({ message: 'Workflow not found' });
            return;
        }

        const isTerminal =
            workflow.status === WorkflowStatus.Completed ||
            workflow.status === WorkflowStatus.Failed;

        if (!isTerminal) {
            res.status(400).json({
                message: `Workflow is not in a terminal state (current status: ${workflow.status})`,
            });
            return;
        }

        if (workflow.finalResult == null) {
            res.status(500).json({
                message: `Workflow ${req.params.id} is terminal but has no finalResult`,
            });
            return;
        }

        const parsed = JSON.parse(workflow.finalResult);
        res.status(200).json(parsed);
    });

    return router;
}

const defaultRouter = createWorkflowRouter(AppDataSource);
export default defaultRouter;
