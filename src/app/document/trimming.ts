// TRIM・EXTEND の、クリックした位置の図形を探して、境界を集めて、図面に適用する。React にも画面にも依存しない。
// 1回のクリックが、1つの変更(ChangeSet)で、Undo の1段階。
//
// 手順: (1) クリックの位置にある、編集できる図形(線・円弧・円・折れ線)を探す(いちばん近いもの)
//       (2) 境界を集める(選んだ図形、または、表示中のすべての図形。対象の図形自身は除く)
//       (3) core/geometry/trim.ts で、切り取り・延長の結果を求める
//       (4) 結果を適用する: 1つ残る=置き換え、2つに分かれる=置き換え + 追加(2つ目は、新しい図形)、無くなる=削除
// 元データとの対応は、形が変わったので reshaped の印を付ける(分かれた2つ目も、同じ元の記録を指す。コピーと同じ規則)。
import { removeEntitiesChangeSet, replaceEntitiesChangeSet } from "../../core/history";
import type { ChangeSet } from "../../core/history";
import { indexOfEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import { findEntitiesNearPoint } from "../../core/selection/Selection";
import { edgePrimitivesOf, extendEntity, NO_INTERSECTION_REASON, trimEntity } from "../../core/geometry/trim";
import type { EdgePrimitive, TrimResult } from "../../core/geometry/trim";
import { BOUNDS_STRIDE, computeAllEntityBounds } from "../../core/spatial/entityBounds";
import type { CadEntity, Point2D } from "../../types/cad";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";
import { reshapedSourceRecord } from "./editing";
import type { EditOutcome } from "./editing";

export type TrimMode = "trim" | "extend";

const MODE_NAME: Record<TrimMode, string> = { trim: "トリム", extend: "延長" };
/** 対象にできる図形の種類(ほかは、理由つきで断る) */
const SUPPORTED_TYPES: ReadonlySet<CadEntity["type"]> = new Set(["LINE", "ARC", "CIRCLE", "LWPOLYLINE", "POLYLINE"]);

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
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !(toleranceWorld > 0) || !Number.isFinite(toleranceWorld)) {
    return { ok: false, message: `${name}できませんでした: クリックの位置が正しくありません` };
  }
  const document = session.document;
  const entities = document.entities;
  const bounds = computeAllEntityBounds(entities);

  // (1) クリックの位置の図形。範囲が点の近くにあるものだけを、距離で調べる(全図形の距離を計算しない)
  const near: CadEntity[] = [];
  for (let i = 0, o = 0; i < entities.length; i++, o += BOUNDS_STRIDE) {
    if (point.x >= bounds[o] - toleranceWorld && point.x <= bounds[o + 2] + toleranceWorld && point.y >= bounds[o + 1] - toleranceWorld && point.y <= bounds[o + 3] + toleranceWorld) near.push(entities[i]);
  }
  const hits = findEntitiesNearPoint(near, visibleLayerNames, point, toleranceWorld);
  if (hits.length === 0) return { ok: false, message: `${name}: クリックした所に図形がありません(図形の線の上をクリックしてください)` };
  let target: CadEntity | null = null;
  let firstReason: string | null = null;
  for (const hit of hits) {
    const why = editability.reasonFor(hit.id);
    if (why !== null) {
      firstReason ??= why;
      continue;
    }
    if (!SUPPORTED_TYPES.has(hit.type)) {
      firstReason ??= `${hit.type} は、${name}できません(線・円弧・円・折れ線が対象です)`;
      continue;
    }
    target = hit;
    break;
  }
  if (target === null) return { ok: false, message: `${name}できません: ${firstReason ?? "対象にできる図形がありません"}` };

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
  if (result.pieces.some((piece) => !isFinitePiece(piece))) return { ok: false, message: `${name}できませんでした: 結果の座標が正しくありません` };

  // (4) 適用
  const record = reshapedSourceRecord(target);
  const withRecord = (entity: CadEntity): CadEntity => (record === undefined ? entity : { ...entity, sourceRecord: record });
  const label = mode === "trim" ? "図形をトリム" : "図形を延長";
  let changeSet: ChangeSet;
  let detail: string;
  try {
    if (result.pieces.length === 0) {
      changeSet = removeEntitiesChangeSet(document, [target.id], label);
      detail = "(切り取る部分が図形の全体だったため、図形を削除しました)";
    } else {
      const replace = replaceEntitiesChangeSet(document, [withRecord(result.pieces[0])], label);
      if (result.pieces.length === 1) {
        changeSet = replace;
        detail = "";
      } else {
        // 2つに分かれた: 2つ目は、新しい図形。元の図形のすぐ上の描画順に入れる
        const second = { ...withRecord(result.pieces[1]), id: session.allocateEntityId() } as CadEntity;
        changeSet = { label, changes: [...replace.changes, { kind: "add", entity: second, index: targetIndex + 1 }] };
        detail = "(2つの図形に分かれました)";
      }
    }
  } catch (error) {
    return { ok: false, message: `${name}できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return { ok: false, message: `${name}できませんでした: ${outcome.error}` };
  return { ok: true, message: `図形を${name}しました${detail}` };
}

/** 結果の図形の座標が、すべて有限か(桁あふれ・計算の失敗で、壊れた図形を作らないための確認) */
function isFinitePiece(entity: CadEntity): boolean {
  switch (entity.type) {
    case "LINE":
      return [entity.start.x, entity.start.y, entity.end.x, entity.end.y].every(Number.isFinite);
    case "LWPOLYLINE":
    case "POLYLINE":
      return entity.vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
    case "ARC":
      return [entity.center.x, entity.center.y, entity.radius, entity.startAngle, entity.endAngle].every(Number.isFinite);
    default:
      return true;
  }
}
