// クリックした位置にある、編集できる図形を探す(TRIM・EXTEND・OFFSET・BREAK 共通)。React にも画面にも依存しない。
// 手順: 範囲が点の近くにあるものだけを、距離で調べる(全図形の距離を計算しない)。いちばん近い図形から順に、
// 編集できるか・対象の種類かを見て、最初に合うものを返す。合うものが無ければ、理由つきで断る。
import { findEntitiesNearPoint } from "../../core/selection/Selection";
import { BOUNDS_STRIDE, computeAllEntityBounds } from "../../core/spatial/entityBounds";
import type { CadEntity, Point2D } from "../../types/cad";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";

export type PickOutcome = { ok: true; entity: CadEntity } | { ok: false; message: string };

/** 線・円弧・円・折れ線(TRIM・OFFSET・BREAK の対象の種類) */
export const CURVE_TYPES: ReadonlySet<CadEntity["type"]> = new Set(["LINE", "ARC", "CIRCLE", "LWPOLYLINE", "POLYLINE"]);

/**
 * 点 point の位置にある図形(対象にできるもの)を、1つ探す。
 * @param toleranceWorld 図形を指すときの許容距離(図面上の長さ)
 * @param name 操作の名前(「トリム」など)。断りの文に使う
 * @param bounds 全図形の範囲(computeAllEntityBounds)。呼び出し側が持っているときは渡す(再計算しない)
 */
export function pickEntityAt(
  session: DocumentSession,
  editability: Editability,
  point: Point2D,
  toleranceWorld: number,
  visibleLayerNames: ReadonlySet<string>,
  supportedTypes: ReadonlySet<CadEntity["type"]>,
  name: string,
  bounds: ArrayLike<number> = computeAllEntityBounds(session.document.entities),
): PickOutcome {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !(toleranceWorld > 0) || !Number.isFinite(toleranceWorld)) {
    return { ok: false, message: `${name}できませんでした: クリックの位置が正しくありません` };
  }
  const entities = session.document.entities;
  const near: CadEntity[] = [];
  for (let i = 0, o = 0; i < entities.length; i++, o += BOUNDS_STRIDE) {
    if (point.x >= bounds[o] - toleranceWorld && point.x <= bounds[o + 2] + toleranceWorld && point.y >= bounds[o + 1] - toleranceWorld && point.y <= bounds[o + 3] + toleranceWorld) near.push(entities[i]);
  }
  const hits = findEntitiesNearPoint(near, visibleLayerNames, point, toleranceWorld);
  if (hits.length === 0) return { ok: false, message: `${name}: クリックした所に図形がありません(図形の線の上をクリックしてください)` };
  let firstReason: string | null = null;
  for (const hit of hits) {
    const why = editability.reasonFor(hit.id);
    if (why !== null) {
      firstReason ??= why;
      continue;
    }
    if (!supportedTypes.has(hit.type)) {
      firstReason ??= `${hit.type} は、${name}できません(線・円弧・円・折れ線が対象です)`;
      continue;
    }
    return { ok: true, entity: hit };
  }
  return { ok: false, message: `${name}できません: ${firstReason ?? "対象にできる図形がありません"}` };
}
