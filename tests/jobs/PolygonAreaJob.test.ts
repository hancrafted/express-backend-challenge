import { describe, it, expect } from "vitest";
import { PolygonAreaJob } from "../../src/jobs/PolygonAreaJob";
import { Task } from "../../src/models/Task";

function makeTask(geoJson: unknown): Task {
  const t = new Task();
  t.geoJson = typeof geoJson === "string" ? geoJson : JSON.stringify(geoJson);
  t.taskType = "polygonArea";
  return t;
}

describe("PolygonAreaJob", () => {
  it("returns the geodesic area in square metres for a Feature<Polygon>", async () => {
    const job = new PolygonAreaJob();
    const feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [125, -15],
            [113, -22],
            [154, -27],
            [144, -15],
            [125, -15],
          ],
        ],
      },
    };

    const area = await job.run(makeTask(feature));

    expect(typeof area).toBe("number");
    expect(area).toBeGreaterThan(0);
  });

  it("returns a positive area for a bare Polygon geometry", async () => {
    const job = new PolygonAreaJob();
    const polygon = {
      type: "Polygon",
      coordinates: [
        [
          [125, -15],
          [113, -22],
          [154, -27],
          [144, -15],
          [125, -15],
        ],
      ],
    };

    const result = await job.run(makeTask(polygon));

    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  it("returns a positive area for a MultiPolygon geometry", async () => {
    const job = new PolygonAreaJob();
    const multi = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ],
        [
          [
            [10, 10],
            [10, 11],
            [11, 11],
            [11, 10],
            [10, 10],
          ],
        ],
      ],
    };

    const result = await job.run(makeTask(multi));

    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  it("throws a descriptive Error when geoJson is not valid JSON", async () => {
    const job = new PolygonAreaJob();
    const task = makeTask("{not json");

    await expect(job.run(task)).rejects.toThrow(/invalid geojson/i);
  });

  it("throws a descriptive Error for non-polygon geometry (e.g. Point)", async () => {
    const job = new PolygonAreaJob();
    const point = { type: "Point", coordinates: [0, 0] };

    await expect(job.run(makeTask(point))).rejects.toThrow(
      /polygon|multipolygon/i,
    );
  });

  it("computes the Readme example polygon area within tolerance", async () => {
    const job = new PolygonAreaJob();
    const readmePolygon = {
      type: "Polygon",
      coordinates: [
        [
          [-63.624885020050996, -10.311050368263523],
          [-63.624885020050996, -10.367865108370523],
          [-63.61278302732815, -10.367865108370523],
          [-63.61278302732815, -10.311050368263523],
          [-63.624885020050996, -10.311050368263523],
        ],
      ],
    };

    const result = await job.run(makeTask(readmePolygon));

    // Roughly ~1.34 km x ~6.3 km rectangular box ≈ 8.4e6 m²
    expect(result).toBeGreaterThan(8_000_000);
    expect(result).toBeLessThan(9_000_000);
  });
});
