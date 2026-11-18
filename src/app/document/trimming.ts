// TRIM・EXTEND の、クリックした位置の図形を探して、境界を集めて、図面に適用する。React にも画面にも依存しない。
// 1回のクリックが、1つの変更(ChangeSet)で、Undo の1段階。
//
// 手順: (1) クリックの位置にある、編集できる図形(線・円弧・円・折れ線)を探す(いちばん近いもの)
//       (2) 境界を集める(選んだ図形、または、表示中のすべての図形。対象の図形自身は除く)
//       (3) core/geometry/trim.ts で、切り取り・延長の結果を求める
//       (4) 結果を適用する: 1つ残る=置き換え、2つに分かれる=置き換え + 追加(2つ目は、新しい図形)、無くなる=削除
// 元データとの対応は、形が変わったので reshaped の印を付ける(分かれた2つ目も、同じ元の記録を指す。コピーと同じ規則)。
import { indexOfEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import { edgePrimitivesOf, extendEntity, NO_INTERSECTION_REASON, trimEntity } from "../../core/geometry/trim";
import type { EdgePrimitive, TrimResult } from "../../core/geometry/trim";
import { BOUNDS_STRIDE, computeAllEntityBounds } from "../../core/spatial/entityBounds";
import type { CadEntity, Point2D } from "../../types/cad";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";
import { applyPieces } from "./pieces";
import { CURVE_TYPES, pickEntityAt } from "./picking";
import type { EditOutcome } from "./editing";

export type TrimMode = "trim" | "extend";

const MODE_NAME: Record<TrimMode, string> = { trim: "トリム", extend: "延長" };
/** 対象にできる図形の種類(ほかは、理由つきで断る) */
const SUPPORTED_TYPES = CURVE_TYPES;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function boxOf(bounds: ArrayLike<number>, i: number): Box {
  const o = i * BOUNDS_STRIDE;
  return { minX: bounds[o], minY: bounds[o + 1], maxX: bounds[o + 2], maxY: bounds[o + 3] };
}

const boxesOverlap = (a: Box, b: Box): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** 直線(a から b の向きに、両方向へ無限に延ばしたもの)が、箱と交わるか(スラブ法) */
function lineHitsBox(a: Point2D, b: Point2D, box: Box): boolean {
  let tMin = -Infinity;
  let tMax = Infinity;
  for (const [origin, delta, lo, hi] of [
    [a.x, b.x - a.x, box.minX, box.maxX],
    [a.y, b.y - a.y, box.minY, box.maxY],
  ] as const) {
    if (delta === 0) {
      if (origin < lo || origin > hi) return false;
      continue;
    }
    const t1 = (lo - origin) / delta;
    const t2 = (hi - origin) / delta;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  return tMin <= tMax;
}

/** 対象の図形から見て、境界になりうる図形の範囲(トリム=図形自身の範囲。延長=延ばした先まで含む領域の判定) */
/** 範囲の判定の余裕(mm)。core の交点の判定は、境界の線分の端から 1e-9 mm 外れた交点も認める。丸め誤差でわずかに離れた境界(T字の接点)を、前段で捨てないための、それより大きな余裕 */
const BOX_MARGIN = 1e-6;

function grow(box: Box): Box {
  return { minX: box.minX - BOX_MARGIN, minY: box.minY - BOX_MARGIN, maxX: box.maxX + BOX_MARGIN, maxY: box.maxY + BOX_MARGIN };
}

function candidateTest(target: CadEntity, rawTargetBox: Box, mode: TrimMode): (bounds: ArrayLike<number>, offset: number) => boolean {
  const targetBox = grow(rawTargetBox);
  if (mode === "trim") return (bounds, o) => bounds[o] <= targetBox.maxX && bounds[o + 2] >= targetBox.minX && bounds[o + 1] <= targetBox.maxY && bounds[o + 3] >= targetBox.minY;
  if (target.type === "ARC") {
    // 円弧は、円に沿って延びる: 円全体の範囲
    const circle: Box = { minX: target.center.x - target.radius, minY: target.center.y - target.radius, maxX: target.center.x + target.radius, maxY: target.center.y + target.radius };
    return (bounds, o) => boxesOverlap({ minX: bounds[o], minY: bounds[o + 1], maxX: bounds[o + 2], maxY: bounds[o + 3] }, grow(circle));
  }
  // 線・折れ線は、端の線分を、向きのままに延ばす: その直線が通る範囲
  const vertices = target.type === "LINE" ? [target.start, target.end] : target.type === "LWPOLYLINE" || target.type === "POLYLINE" ? target.vertices : [];
  if (vertices.length < 2) return () => false;
  const n = vertices.length;
  const first: [Point2D, Point2D] = [vertices[1], vertices[0]];
  const last: [Point2D, Point2D] = [vertices[n - 2], vertices[n - 1]];
  return (bounds, o) => {
    const box = grow({ minX: bounds[o], minY: bounds[o + 1], maxX: bounds[o + 2], maxY: bounds[o + 3] });
    return lineHitsBox(first[0], first[1], box) || lineHitsBox(last[0], last[1], box);
  };
}

/**
 * クリックした位置 point で、トリム・延長する。
 * @param toleranceWorld 図形を指すときの許容距離(図面上の長さ)
 * @param edgeIds 境界にする図形のID。null なら、表示中のすべての図形
 * @param visibleLayerNames 表示中のレイヤー(非表示のレイヤーの図形は、対象にも境界にもしない)
 */
export function trimOrExtendAt(
  session: DocumentSession,
  editability: Editability,
  mode: TrimMode,
  point: Point2D,
  toleranceWorld: number,
  edgeIds: readonly EntityId[] | null,
  visibleLayerNames: ReadonlySet<string>,
): EditOutcome {
  const name = MODE_NAME[mode];
  const document = session.document;
  const entities = document.entities;
  const bounds = computeAllEntityBounds(entities);

  // (1) クリックの位置の図形(いちばん近い、編集できる、対象の種類のもの)
  const picked = pickEntityAt(session, editability, point, toleranceWorld, visibleLayerNames, SUPPORTED_TYPES, name, bounds);
  if (!picked.ok) return picked;
  const target = picked.entity;

  // (2) 境界(対象の図形自身は除く)。範囲が、対象に関わらないものは、調べない
  const targetIndex = indexOfEntity(document, target.id);
  const wanted = edgeIds === null ? null : new Set(edgeIds);
  const overlaps = candidateTest(target, boxOf(bounds, targetIndex), mode);
  const edges: EdgePrimitive[] = [];
  for (let i = 0; i < entities.length; i++) {
    if (i === targetIndex) continue;
    // 範囲の判定を先に(軽い)。表示・ID の判定は、範囲が重なるものだけ
    if (!overlaps(bounds, i * BOUNDS_STRIDE)) continue;
    const entity = entities[i];
    if (!visibleLayerNames.has(entity.layer)) continue;
    if (wanted !== null && !wanted.has(entity.id)) continue;
    for (const primitive of edgePrimitivesOf(entity)) edges.push(primitive);
  }
  if (edges.length === 0) return { ok: false, message: `${name}できません: ${NO_INTERSECTION_REASON}` };

  // (3) 結果
  let result: TrimResult;
  try {
    result = mode === "trim" ? trimEntity(target, point, edges) : extendEntity(target, point, edges);
  } catch (error) {
    return { ok: false, message: `${name}できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!result.ok) return { ok: false, message: `${name}できません: ${result.reason}` };

  // (4) 適用(結果の座標が有限かの確認も、ここで行う)
  const label = mode === "trim" ? "図形をトリム" : "図形を延長";
  const applied = applyPieces(session, target, result.pieces, label, name, "(切り取る部分が図形の全体だったため、図形を削除しました)");
  if (!applied.ok) return applied;
  return { ok: true, message: `図形を${name}しました${applied.detail}` };
}