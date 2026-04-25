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

        const coordinates =
            parsed?.type === 'Feature' ? parsed?.geometry?.coordinates : parsed?.coordinates;
        if (geometryType === 'Polygon') {
            validatePolygonRings(coordinates);
        } else {
            if (!Array.isArray(coordinates)) {
                throw new Error('Invalid GeoJSON: MultiPolygon coordinates must be an array');
            }
            for (const polygon of coordinates) {
                validatePolygonRings(polygon);
            }
        }

        return area(parsed);
    }
}

function validatePolygonRings(rings: unknown): void {
    if (!Array.isArray(rings)) {
        throw new Error('Invalid GeoJSON: Polygon coordinates must be an array of rings');
    }
    for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4) {
            throw new Error('Invalid GeoJSON: each Polygon ring must have at least 4 coordinates');
        }
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (
            !Array.isArray(first) ||
            !Array.isArray(last) ||
            first.length !== last.length ||
            !first.every((v: unknown, i: number) => v === last[i])
        ) {
            throw new Error('Invalid GeoJSON: each Polygon ring must be closed (first coord equals last)');
        }
    }
}
