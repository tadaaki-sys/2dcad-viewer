// 編集コマンド(MOVE・COPY・ROTATE)の、動かした形の仮表示(ゴム紐)を作る。図面のデータは変えない。画面にも依存しない。
import type { Affine2D, CadEntity, Point2D } from "../../types/cad";
import { getEntityPoints, getTextBoundingBoxCorners } from "../geometry/entityGeometry";
import { stretchEntityGeometry, windowCorners } from "../geometry/stretch";
import type { StretchWindow } from "../geometry/stretch";
import { applyAffine, transformEntityGeometry } from "../geometry/transform";
import { computeAllEntityBounds } from "../spatial/entityBounds";
import type { PreviewShape } from "./registry";

/** この数を超える図形を選んでいるときは、1つ1つの形ではなく、全体を囲む枠だけを表示する(カーソルを動かすたびの計算を、軽く保つ) */
export const PREVIEW_ENTITY_LIMIT = 300;

/**
 * 図形の頂点の合計が、この数を超えるときも、枠だけを表示する(巨大な折れ線1本でも、カーソルを動かすたびに、全頂点を計算しないように)。
 * 図形の数の上限(PREVIEW_ENTITY_LIMIT)とは別に、頂点の数でも見る。
 */
export const PREVIEW_VERTEX_LIMIT = 20_000;

/** 仮表示の計算の重さ(頂点の数。頂点を持たない図形は 1) */
function previewWeight(entity: CadEntity): number {
  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") return Math.max(1, entity.vertices.length);
  if (entity.type === "SPLINE") return Math.max(1, entity.points.length);
  return 1;
}

function totalWeight(entities: readonly CadEntity[]): number {
  let total = 0;
  for (const entity of entities) total += previewWeight(entity);
  return total;
}

/** 図形1つを、変換して動かした形の仮表示。点(POINT)は、表示する形が無いので、空 */
export function entityPreviewShapes(entity: CadEntity, matrix: Affine2D): PreviewShape[] {
  let moved: CadEntity;
  try {
    moved = transformEntityGeometry(entity, matrix);
  } catch {
    // 桁あふれなどで動かせない図形は、仮表示を出さない(確定のときに、理由つきで拒否される)
    return [];
  }
  return shapesOf(moved);
}

/** 図形そのものの形の仮表示。点(POINT)は、表示する形が無いので、空 */
function shapesOf(moved: CadEntity): PreviewShape[] {
  switch (moved.type) {
    case "LINE":
      return [{ kind: "polyline", points: [moved.start, moved.end], closed: false }];
    case "LWPOLYLINE":
    case "POLYLINE":
      return [{ kind: "polyline", points: moved.vertices, closed: moved.closed }];
    case "CIRCLE":
      return [{ kind: "circle", center: moved.center, radius: moved.radius }];
    case "ARC":
      return [{ kind: "arc", center: moved.center, radius: moved.radius, startAngle: moved.startAngle, endAngle: moved.endAngle }];
    case "ELLIPSE":
    case "SPLINE":
      return [{ kind: "polyline", points: getEntityPoints(moved), closed: false }];
    case "TEXT":
      return [{ kind: "polyline", points: getTextBoundingBoxCorners(moved), closed: true }];
    case "POINT":
      return [];
  }
}

/** 図形の一覧を囲む枠(外接の矩形)。有限な値がなければ null */
function boundingBox(entities: readonly CadEntity[]): { min: Point2D; max: Point2D } | null {
  const bounds = computeAllEntityBounds(entities);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 3 < bounds.length; i += 4) {
    if (!Number.isFinite(bounds[i]) || !Number.isFinite(bounds[i + 1]) || !Number.isFinite(bounds[i + 2]) || !Number.isFinite(bounds[i + 3])) continue;
    minX = Math.min(minX, bounds[i]);
    minY = Math.min(minY, bounds[i + 1]);
    maxX = Math.max(maxX, bounds[i + 2]);
    maxY = Math.max(maxY, bounds[i + 3]);
  }
  return Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
    ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
    : null;
}

/**
 * 選んだ図形の仮表示を作る関数を返す(選んだ図形は、コマンドの間、変わらないので、枠の計算などは、最初の1回だけ)。
 * 返した関数に、変換(の一覧)を渡すと、それぞれの変換で動かした形を返す。
 * 図形が PREVIEW_ENTITY_LIMIT を超えるときは、全体を囲む枠だけを、変換ごとに1つ返す。
 */
export function createSelectionPreview(entities: readonly CadEntity[], limit: number = PREVIEW_ENTITY_LIMIT): (matrices: readonly Affine2D[]) => readonly PreviewShape[] {
  if (entities.length > limit || totalWeight(entities) > PREVIEW_VERTEX_LIMIT) {
    const box = boundingBox(entities);
    if (box === null) return () => [];
    const corners: Point2D[] = [
      { x: box.min.x, y: box.min.y },
      { x: box.max.x, y: box.min.y },
      { x: box.max.x, y: box.max.y },
      { x: box.min.x, y: box.max.y },
    ];
    return (matrices) => matrices.map((matrix) => ({ kind: "polyline" as const, points: corners.map((corner) => applyAffine(matrix, corner)), closed: true }));
  }
  return (matrices) => matrices.flatMap((matrix) => entities.flatMap((entity) => entityPreviewShapes(entity, matrix)));
}

/**
 * ストレッチ(STRETCH)の仮表示を作る関数を返す。返した関数に移動量(dx, dy)を渡すと、窓の中の頂点を動かした形を返す。
 * 図形が limit を超えるときは、移動した窓の枠だけを返す(カーソルを動かすたびの計算を、軽く保つため)。
 */
export function createStretchPreview(entities: readonly CadEntity[], window: StretchWindow, limit: number = PREVIEW_ENTITY_LIMIT): (dx: number, dy: number) => readonly PreviewShape[] {
  if (entities.length > limit || totalWeight(entities) > PREVIEW_VERTEX_LIMIT) {
    const corners = windowCorners(window);
    return (dx, dy) => [{ kind: "polyline", points: corners.map((corner) => ({ x: corner.x + dx, y: corner.y + dy })), closed: true }];
  }
  return (dx, dy) =>
    entities.flatMap((entity) => {
      try {
        const outcome = stretchEntityGeometry(entity, window, dx, dy);
        return outcome.kind === "moved" || outcome.kind === "reshaped" ? shapesOf(outcome.entity) : [];
      } catch {
        return [];
      }
    });
}
