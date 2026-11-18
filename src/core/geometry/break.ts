// BREAK(2点間の切断)の幾何の計算。画面にも図面データの保存にも依存しない純粋な処理。
//
// 考え方は TRIM と同じ(trim.ts): 対象の図形を「道」として、道に沿った位置 s で、2点の間を取り除く。
// 点は、図形の上へ射影する(図形から離れた点を指定してもよい)。
// - 線・円弧・開いた折れ線: 2点を、道に沿った位置の順に並べて、間を取り除く。端の外に出た点は、端として扱う。
//   2点が同じ位置なら、取り除く部分なしで、2つに分ける(1点での分割)。
// - 円: 第1点から第2点まで、反時計回りに取り除き、円弧にする。
// - 閉じた折れ線: 第1点から第2点まで、頂点の順に取り除き、開いた1本の折れ線にする(2点が同じ位置なら、その点で開く)。
import type { CadArc, CadEntity, Point2D } from "../../types/cad";
import { normalizeArcSpan } from "./geometry";
import { ANGLE_EPSILON, chainOf, chainSlice, normalizeAngleValue, PARAM_EPSILON, sameStyle, segmentAt, segmentCount } from "./trim";
import type { Chain, TrimResult } from "./trim";

const TWO_PI = Math.PI * 2;

export const BREAK_NOTHING_REASON = "切断する位置が図形の端です(図形は変わりません)";
export const BREAK_SAME_POINT_ON_CIRCLE_REASON = "円は、異なる2点で切断してください(2点が同じ位置です)";

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/**
 * 点から、線分の連なりの上の、最も近い位置 s(線分の番号 + その中の割合)と、その点の座標。
 * 桁あふれなどで位置を求められないときは null(初期値の位置を返すと、入力と違う所を切断してしまうため、呼び出し側が、全体を断る)。
 */
function nearestOnChain(chain: Chain, p: Point2D): { s: number; point: Point2D } | null {
  let bestDistance = Infinity;
  let best: { s: number; point: Point2D } | null = null;
  for (let i = 0; i < segmentCount(chain); i++) {
    const [a, b] = segmentAt(chain, i);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // 二乗(dx*dx)は、座標が 1e154 を超えると桁あふれする。大きい方の成分で割った値で、割合を求める
    const scale = Math.max(Math.abs(dx), Math.abs(dy));
    if (scale === 0) continue;
    if (!Number.isFinite(scale)) return null;
    const ux = dx / scale;
    const uy = dy / scale;
    const raw = (((p.x - a.x) / scale) * ux + ((p.y - a.y) / scale) * uy) / (ux * ux + uy * uy);
    if (!Number.isFinite(raw)) return null;
    let t = clamp(raw, 0, 1);
    let x: number;
    let y: number;
    if (t <= 0) {
      x = a.x;
      y = a.y;
    } else if (t >= 1) {
      x = b.x;
      y = b.y;
    } else if (dy === 0) {
      // 水平の線分: クリックの x をそのまま使う(割合から計算し直すと、30 が 30.000000000000004 になるなど、丸め誤差が入る)
      x = clamp(p.x, Math.min(a.x, b.x), Math.max(a.x, b.x));
      y = a.y;
      t = (x - a.x) / dx;
    } else if (dx === 0) {
      x = a.x;
      y = clamp(p.y, Math.min(a.y, b.y), Math.max(a.y, b.y));
      t = (y - a.y) / dy;
    } else {
      x = a.x + dx * t;
      y = a.y + dy * t;
    }
    const distance = Math.hypot(p.x - x, p.y - y);
    if (!Number.isFinite(distance)) return null;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { s: i + t, point: { x, y } };
    }
  }
  return best;
}

/** 円・円弧の中心に近すぎて、中心からの方向が決まらない点か */
function atCenter(center: Point2D, radius: number, p: Point2D): boolean {
  return Math.hypot(p.x - center.x, p.y - center.y) <= 1e-9 * Math.max(1, radius);
}

export const BREAK_AT_CENTER_REASON = "点が円(円弧)の中心にあります(方向が決まりません)。中心以外の点を指示してください";
export const BREAK_UNCOMPUTABLE_REASON = "座標が大きすぎて、切断する位置を求められません";

/**
 * 対象の図形を、2点 first・second の間で切断する。pieces は、残る図形(IDなし)。0個なら、図形ごと無くなる。
 * 切断できないもの(対象外・何も変わらない・円で2点が同じ位置)は、理由つきで ok: false。
 */
export function breakEntity(target: CadEntity, first: Point2D, second: Point2D): TrimResult {
  if (![first.x, first.y, second.x, second.y].every(Number.isFinite)) return { ok: false, reason: "点の位置が正しくありません" };

  if (target.type === "LINE" || target.type === "LWPOLYLINE" || target.type === "POLYLINE") {
    const chain = chainOf(target);
    const count = segmentCount(chain);
    if (count < 1) return { ok: false, reason: "線分がありません" };
    const p1 = nearestOnChain(chain, first);
    const p2 = nearestOnChain(chain, second);
    if (p1 === null || p2 === null) return { ok: false, reason: BREAK_UNCOMPUTABLE_REASON };
    const pieceOf = (points: Point2D[]): CadEntity =>
      target.type === "LINE" ? { ...target, start: points[0], end: points[points.length - 1] } : { ...target, vertices: points, closed: false };

    if (chain.closed) {
      // 閉じた連なり: 第1点から第2点まで(頂点の順に)取り除く。残るのは、第2点から、巻き込んで第1点まで
      const s1 = p1.s % count;
      const s2 = p2.s % count;
      const gap = Math.abs(s1 - s2);
      if (gap <= PARAM_EPSILON || gap >= count - PARAM_EPSILON) {
        // 同じ位置: その点で開く
        return { ok: true, pieces: [pieceOf(chainSlice(chain, s1, s1 + count, p1.point, p1.point))] };
      }
      const to = s1 > s2 ? s1 : s1 + count;
      return { ok: true, pieces: [pieceOf(chainSlice(chain, s2, to, p2.point, p1.point))] };
    }

    // 開いた連なり: 位置の順に並べて、間を取り除く
    const [a, b] = p1.s <= p2.s ? [p1, p2] : [p2, p1];
    if (b.s <= PARAM_EPSILON || a.s >= count - PARAM_EPSILON) return { ok: false, reason: BREAK_NOTHING_REASON };
    const pieces: CadEntity[] = [];
    if (a.s > PARAM_EPSILON) pieces.push(pieceOf(chainSlice(chain, 0, a.s, null, a.point)));
    if (b.s < count - PARAM_EPSILON) pieces.push(pieceOf(chainSlice(chain, b.s, count, b.point, null)));
    return { ok: true, pieces };
  }

  if ((target.type === "ARC" || target.type === "CIRCLE") && (atCenter(target.center, target.radius, first) || atCenter(target.center, target.radius, second))) {
    return { ok: false, reason: BREAK_AT_CENTER_REASON };
  }

  if (target.type === "ARC") {
    const span = normalizeArcSpan(target.startAngle, target.endAngle);
    // 点の、始点からの角度。円弧の外(反対側)の点は、近い方の端
    const positionOf = (p: Point2D): number => {
      const angle = Math.atan2(p.y - target.center.y, p.x - target.center.x);
      let s = (((angle - target.startAngle) % TWO_PI) + TWO_PI) % TWO_PI;
      if (s > TWO_PI - ANGLE_EPSILON) s = 0;
      if (s > span) s = s - span < TWO_PI - s ? span : 0;
      return s;
    };
    const s1 = positionOf(first);
    const s2 = positionOf(second);
    const a = Math.min(s1, s2);
    const b = Math.max(s1, s2);
    if (b <= ANGLE_EPSILON || a >= span - ANGLE_EPSILON) return { ok: false, reason: BREAK_NOTHING_REASON };
    const pieces: CadEntity[] = [];
    if (a > ANGLE_EPSILON) pieces.push({ ...target, endAngle: normalizeAngleValue(target.startAngle + a) } as CadArc);
    if (b < span - ANGLE_EPSILON) pieces.push({ ...target, startAngle: normalizeAngleValue(target.startAngle + b) } as CadArc);
    return { ok: true, pieces };
  }

  if (target.type === "CIRCLE") {
    const angle1 = Math.atan2(first.y - target.center.y, first.x - target.center.x);
    const angle2 = Math.atan2(second.y - target.center.y, second.x - target.center.x);
    const difference = (((angle2 - angle1) % TWO_PI) + TWO_PI) % TWO_PI;
    if (difference <= ANGLE_EPSILON || difference >= TWO_PI - ANGLE_EPSILON) return { ok: false, reason: BREAK_SAME_POINT_ON_CIRCLE_REASON };
    // 第1点から第2点まで反時計回りに取り除く = 残るのは、第2点から第1点まで反時計回り
    const arc = { ...sameStyle(target), type: "ARC", startAngle: normalizeAngleValue(angle2), endAngle: normalizeAngleValue(angle1) } as CadArc;
    return { ok: true, pieces: [arc] };
  }

  return { ok: false, reason: `${target.type} は、切断できません(線・円弧・円・折れ線が対象です)` };
}
