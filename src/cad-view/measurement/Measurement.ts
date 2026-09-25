import { distance } from "../../utils/geometry";
import type { Point2D } from "../../types/cad";

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
