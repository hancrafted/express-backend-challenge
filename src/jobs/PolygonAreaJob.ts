import area from '@turf/area';
import { Job, JobContext } from './Job';
import { Task } from '../models/Task';

export class PolygonAreaJob implements Job {
    async run(task: Task, _context?: JobContext): Promise<number> {
        let parsed: any;
        try {
            parsed = JSON.parse(task.geoJson);
        } catch (err: any) {
            throw new Error(`Invalid GeoJSON: ${err.message}`);
        }

        const geometryType =
            parsed?.type === 'Feature' ? parsed?.geometry?.type : parsed?.type;
        if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') {
            throw new Error(
                `Invalid GeoJSON: expected Polygon or MultiPolygon, got ${geometryType ?? 'unknown'}`,
            );
        }

        return area(parsed);
    }
}
