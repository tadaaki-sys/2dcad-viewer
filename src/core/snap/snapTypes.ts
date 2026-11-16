// Snap の種類と候補の型(仕様 16: Endpoint・Midpoint・Intersection・Center・Quadrant・Perpendicular・Tangent・Nearest・Extension・Grid)。
import type { Point2D } from "../../types/cad";

export type SnapType =
  | "endpoint"
  | "midpoint"
  | "intersection"
  | "center"
  | "quadrant"
  | "perpendicular"
  | "tangent"
  | "nearest"
  | "extension"
  | "grid";

export type SnapCandidate = {
  point: Point2D;
  type: SnapType;
};

/** 図形に吸着する種類(OSNAP の対象)。表示の順 */
export const OBJECT_SNAP_TYPES: readonly SnapType[] = [
  "endpoint",
  "midpoint",
  "intersection",
  "center",
  "quadrant",
  "perpendicular",
  "tangent",
  "nearest",
  "extension",
];

export const SNAP_TYPE_LABELS: Record<SnapType, string> = {
  endpoint: "端点",
  midpoint: "中点",
  intersection: "交点",
  center: "中心",
  quadrant: "四半円点",
  perpendicular: "垂線",
  tangent: "接線",
  nearest: "近接",
  extension: "延長",
  grid: "グリッド",
};
