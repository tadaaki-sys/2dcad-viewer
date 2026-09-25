import { distance, pointToSegmentDistance } from "../../utils/geometry";
import type { Measurement, Point2D } from "../../types/cad";

export type MeasurementDistances = {
  horizontal: number;
  vertical: number;
  direct: number;
};

export function computeMeasurementDistances(pointA: Point2D, pointB: Point2D): MeasurementDistances {
  return {
    horizontal: Math.abs(pointB.x - pointA.x),
    vertical: Math.abs(pointB.y - pointA.y),
    direct: distance(pointA, pointB),
  };
}

function distanceFromMeasurement(measurement: Measurement, point: Point2D): number {
  const { pointA, pointB } = measurement;
  const corner: Point2D = { x: pointB.x, y: pointA.y };

  return Math.min(
    distance(point, pointA),
    distance(point, pointB),
    pointToSegmentDistance(point, pointA, pointB),
    pointToSegmentDistance(point, pointA, corner),
    pointToSegmentDistance(point, corner, pointB),
  );
}

/**
 * ワールド座標point付近でtoleranceWorld以内にある最も近いMeasurement(Point A/B・直線・水平/垂直補助線のいずれか)を返す。
 * 図面上でMeasurementを選択して削除する操作のためのヒットテスト。
 */
export function findMeasurementAtPoint(
  measurements: readonly Measurement[],
  point: Point2D,
  toleranceWorld: number,
): Measurement | null {
  let closest: Measurement | null = null;
  let closestDistance = toleranceWorld;

  for (const measurement of measurements) {
    const dist = distanceFromMeasurement(measurement, point);
    if (dist <= closestDistance) {
      closestDistance = dist;
      closest = measurement;
    }
  }

  return closest;
}
