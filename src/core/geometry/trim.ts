// TRIM(トリム)・EXTEND(延長)の幾何の計算。画面にも図面データの保存にも依存しない純粋な処理。
//
// 考え方: 対象の図形を「道(curve)」として、道に沿った位置 s(線分の連なりは「何番目の線分 + その中の位置」、円弧・円は
// 始点からの角度)で表す。境界との交点を s で求めて、クリックした位置 s の前後の交点を見つけ、間を切り取る(トリム)、
// 端から先の最も近い交点まで延ばす(延長)。
//
// 境界にできる図形: 線・円・円弧・折れ線・楕円・スプライン(円と円弧は正確に。そのほかは、線分に近似した形で交点を求める)。
// 対象にできる図形: 線・円弧・円・折れ線(線分の連なり)。取り込んだ折れ線は、円弧の膨らみが展開済みの点列なので、
// 点列の上で扱う(交点の位置は、点列の細かさの分だけ、実際の円弧とずれうる)。
import type { CadArc, CadEntity, CadLine, CadPolyline, Point2D } from "../../types/cad";
import { getEntitySegments } from "./entityGeometry";
import { isAngleInArcSweep } from "./curves";
import { normalizeArcSpan } from "./geometry";

const TWO_PI = Math.PI * 2;
/**
 * 位置 s(線分の連なりの割合・円弧の角度)の比較の許容(同じ交点とみなす)。割合の許容は、線が長いほど、実際の長さでは大きくなる
 * (1e-9 だと、長さ 1e12 の線で 1000 に相当し、残すべき区間を消してしまう)ので、割合の丸め誤差(1e-16 程度)より十分大きい、小さな値にする。
 */
export const PARAM_EPSILON = 1e-12;
/** 座標(mm)の許容。境界の線分の端の上の交点が、丸め誤差で外れないようにする(線の長さによらない、絶対の長さ) */
const COORD_EPSILON = 1e-9;
/** 角度(ラジアン)の許容 */
export const ANGLE_EPSILON = 1e-9;

// ---- 境界の図形(境界として使う形) ----

export type EdgePrimitive =
  | { kind: "segment"; a: Point2D; b: Point2D }
  /** 円(sweep が無い)または円弧(startAngle から endAngle へ反時計回り) */
  | { kind: "circle"; center: Point2D; radius: number; sweep?: { startAngle: number; endAngle: number } };

/** 図形を、境界として使う形(線分・円・円弧)の一覧にする。対象にならない図形(文字・点)は空 */
export function edgePrimitivesOf(entity: CadEntity): EdgePrimitive[] {
  if (entity.type === "TEXT" || entity.type === "POINT") return [];
  if (entity.type === "CIRCLE") return [{ kind: "circle", center: entity.center, radius: entity.radius }];
  if (entity.type === "ARC") {
    return [{ kind: "circle", center: entity.center, radius: entity.radius, sweep: { startAngle: entity.startAngle, endAngle: entity.endAngle } }];
  }
  return getEntitySegments(entity).map(([a, b]) => ({ kind: "segment" as const, a, b }));
}

// ---- 直線(無限に延ばした線)と境界の交点 ----

export type LineHit = { t: number; point: Point2D };

/**
 * 点 a から b への直線(a + t·(b − a)。t は何でもよい)と、境界の形との交点の一覧(直線上の位置 t と、交点の座標)。
 * 境界の線分は、その線分の上にあるものだけ。境界の円弧は、角度の範囲にあるものだけ。
 * 交点の座標は、割合 t から計算し直すと丸め誤差が入る(30 が 30.000000000000004 になるなど)ので、水平・垂直の線は、
 * その座標をそのまま使う(水平・垂直の線を、水平・垂直の境界で切る、ふつうの場面で、座標がぴったりになる)。
 */
export function lineIntersections(a: Point2D, b: Point2D, edge: EdgePrimitive): LineHit[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length)) return [];
  // 交点の座標のそろえ方: 直線が垂直(dx = 0)なら x は a.x、水平(dy = 0)なら y は a.y
  const exact = (x: number, y: number): Point2D => ({ x: dx === 0 ? a.x : x, y: dy === 0 ? a.y : y });
  if (edge.kind === "segment") {
    const ex = edge.b.x - edge.a.x;
    const ey = edge.b.y - edge.a.y;
    const denominator = dx * ey - dy * ex; // 平行(または重なり)なら 0
    const scale = length * Math.hypot(ex, ey);
    if (!(scale > 0) || Math.abs(denominator) <= 1e-12 * scale) return [];
    const fx = edge.a.x - a.x;
    const fy = edge.a.y - a.y;
    const t = (fx * ey - fy * ex) / denominator; // 直線上の位置
    const u = (fx * dy - fy * dx) / denominator; // 境界の線分上の位置
    if (!Number.isFinite(t) || !Number.isFinite(u)) return [];
    // 境界の線分の端の上は、丸め誤差で外れないよう、少しだけ許す
    const slack = COORD_EPSILON / Math.hypot(ex, ey);
    if (!(u >= -slack && u <= 1 + slack)) return [];
    const clamped = Math.min(1, Math.max(0, u));
    // 境界が垂直・水平なら、その座標(edge.a の x または y)がぴったりの値
    const x = ex === 0 ? edge.a.x : edge.a.x + ex * clamped;
    const y = ey === 0 ? edge.a.y : edge.a.y + ey * clamped;
    return [{ t, point: exact(x, y) }];
  }
  // 円・円弧: 中心から直線までの距離と、垂線の足の位置で求める(桁落ちしにくい形)
  const ux = dx / length;
  const uy = dy / length;
  const fx = edge.center.x - a.x;
  const fy = edge.center.y - a.y;
  const along = fx * ux + fy * uy;
  const distanceToLine = Math.abs(fx * uy - fy * ux);
  if (!Number.isFinite(along) || !Number.isFinite(distanceToLine) || !(edge.radius > 0)) return [];
  if (distanceToLine > edge.radius * (1 + 1e-9)) return [];
  const half = distanceToLine >= edge.radius ? 0 : Math.sqrt((edge.radius - distanceToLine) * (edge.radius + distanceToLine));
  const positions = half === 0 ? [along] : [along - half, along + half];
  const hits: LineHit[] = [];
  for (const position of positions) {
    const x = a.x + ux * position;
    const y = a.y + uy * position;
    if (edge.sweep !== undefined && !isAngleInArcSweep(Math.atan2(y - edge.center.y, x - edge.center.x), edge.sweep.startAngle, edge.sweep.endAngle)) continue;
    hits.push({ t: position / length, point: exact(x, y) });
  }
  return hits;
}

/** 直線との交点の、直線上の位置 t だけの一覧(lineIntersections の t のみ) */
export function lineIntersectionParams(a: Point2D, b: Point2D, edge: EdgePrimitive): number[] {
  return lineIntersections(a, b, edge).map((hit) => hit.t);
}
/** 円(中心 center、半径 radius)と、境界の形との交点の、円の上の角度(ラジアン、-π〜π)の一覧 */
export function circleIntersectionAngles(center: Point2D, radius: number, edge: EdgePrimitive): number[] {
  if (!(radius > 0)) return [];
  const points: Point2D[] = [];
  if (edge.kind === "segment") {
    const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
    if (!(length > 0) || !Number.isFinite(length)) return [];
    // 線分の上にある交点(線と円の交点を、直線の t から求め、線分の範囲に絞る)
    const probe: EdgePrimitive = { kind: "circle", center, radius };
    for (const t of lineIntersectionParams(edge.a, edge.b, probe)) {
      const slack = COORD_EPSILON / length;
      if (t < -slack || t > 1 + slack) continue;
      const clamped = Math.min(1, Math.max(0, t));
      points.push({ x: edge.a.x + (edge.b.x - edge.a.x) * clamped, y: edge.a.y + (edge.b.y - edge.a.y) * clamped });
    }
  } else {
    points.push(...circlesIntersection(center, radius, edge.center, edge.radius));
    if (edge.sweep !== undefined) {
      const sweep = edge.sweep;
      for (let i = points.length - 1; i >= 0; i--) {
        if (!isAngleInArcSweep(Math.atan2(points[i].y - edge.center.y, points[i].x - edge.center.x), sweep.startAngle, sweep.endAngle)) points.splice(i, 1);
      }
    }
  }
  return points.map((p) => Math.atan2(p.y - center.y, p.x - center.x));
}

/** 2つの円の交点(0〜2個)。curves.ts の intersectCircles と同じ式 */
function circlesIntersection(c1: Point2D, r1: number, c2: Point2D, r2: number): Point2D[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (!(d > 0) || !Number.isFinite(d) || !(r1 > 0) || !(r2 > 0)) return [];
  const eps = 1e-9 * Math.min(r1, r2);
  if (d > r1 + r2 + eps || d < Math.abs(r1 - r2) - eps) return [];
  const a = (d + ((r1 - r2) * (r1 + r2)) / d) / 2;
  const hSquared = (r1 - a) * (r1 + a);
  const h = hSquared > 0 ? Math.sqrt(hSquared) : 0;
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  if (h === 0) return [{ x: mx, y: my }];
  const ox = (-dy / d) * h;
  const oy = (dx / d) * h;
  return [
    { x: mx + ox, y: my + oy },
    { x: mx - ox, y: my - oy },
  ];
}

// ---- 位置 s の区間の計算(図形の種類によらない) ----

/** 位置の一覧を、小さい順にして、近いもの(許容以内)を1つにまとめる */
function sortedUnique(values: readonly number[]): number[] {
  const sorted = values.filter(Number.isFinite).sort((x, y) => x - y);
  const result: number[] = [];
  for (const value of sorted) {
    if (result.length === 0 || value - result[result.length - 1] > PARAM_EPSILON) result.push(value);
  }
  return result;
}

/**
 * トリムで残す区間の一覧(位置 s の [from, to])。道の長さは length(0 から length まで)。
 * - 開いた道(線・円弧・開いた折れ線): クリックの位置 click の前後の交点の間を切り取る。片側にしか交点が無いときは、その先を端まで切り取る。
 *   残る区間は、0〜2個(交点が端の上なら、長さ0の区間は無くなる)。
 * - 閉じた道(円・閉じた折れ線): 交点が2つ以上のときだけ。切り取る区間のぶんを除いた、残りの1区間(巻き込んで、to が length を超えうる)。
 * 交点が無い、または、切り取れない(閉じた道で交点が1つ)ときは null。
 */
export function trimKeepIntervals(intersections: readonly number[], length: number, cyclic: boolean, click: number): Array<[number, number]> | null {
  if (cyclic) {
    // 閉じた道の位置は 0 以上 length 未満にそろえる(length の位置は、0 と同じ点)
    let points = sortedUnique(intersections.map((p) => ((p % length) + length) % length));
    // 0 のすぐ手前(length に近い)の交点は、0 の交点と同じ点
    if (points.length >= 2 && points[points.length - 1] - length > -PARAM_EPSILON && points[0] < PARAM_EPSILON) points = points.slice(0, -1);
    if (points.length < 2) return null;
    const wrapped = ((click % length) + length) % length;
    // クリックの位置の直前・直後の交点(巻き込んで探す)
    let before = points[points.length - 1] - length;
    let after = points[0] + length;
    for (const p of points) {
      if (p <= wrapped) before = p;
    }
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i] > wrapped) after = points[i];
    }
    // 切り取る区間は (before, after)。残る区間は、after から、巻き込んで before + length まで
    return [[after, before + length]];
  }
  const points = sortedUnique(intersections);
  if (points.length === 0) return null;
  // クリックの位置と同じ交点は、手前(lower)として扱う
  let lower: number | null = null;
  let upper: number | null = null;
  for (const p of points) {
    if (p <= click) lower = p;
  }
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i] > click) upper = points[i];
  }
  // 手前に交点があれば、始点から手前の交点まで残る。先に交点があれば、先の交点から終点まで残る。間(と、交点の無い側の端まで)は、切り取る。
  // 交点が端の上のとき(長さ0の区間)は、残さない
  const keep: Array<[number, number]> = [];
  if (lower !== null && lower > PARAM_EPSILON) keep.push([0, lower]);
  if (upper !== null && upper < length - PARAM_EPSILON) keep.push([upper, length]);
  return keep;
}
// ---- 図形ごとの道 ----

/** 線分の連なり(線・折れ線)の道 */
export type Chain = { vertices: Point2D[]; closed: boolean };

export function chainOf(entity: CadLine | CadPolyline): Chain {
  if (entity.type === "LINE") return { vertices: [entity.start, entity.end], closed: false };
  return { vertices: entity.vertices, closed: entity.closed };
}

/** 線分の連なりの、線分の数 */
export function segmentCount(chain: Chain): number {
  const n = chain.vertices.length;
  return chain.closed ? n : n - 1;
}

/** 線分 i の両端(閉じた連なりでは、最後の線分は、最後の頂点から最初の頂点) */
export function segmentAt(chain: Chain, i: number): [Point2D, Point2D] {
  const n = chain.vertices.length;
  return [chain.vertices[i], chain.vertices[(i + 1) % n]];
}

/** 点から、線分の連なりへの最も近い位置 s(線分の番号 + その中の位置) */
function nearestChainPosition(chain: Chain, point: Point2D): number {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i < segmentCount(chain); i++) {
    const [a, b] = segmentAt(chain, i);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    const distanceSquared = (point.x - (a.x + dx * t)) ** 2 + (point.y - (a.y + dy * t)) ** 2;
    if (distanceSquared < best) {
      best = distanceSquared;
      bestS = i + t;
    }
  }
  return bestS;
}

/** 線分 i の長さ */
function segmentLength(chain: Chain, i: number): number {
  const [a, b] = segmentAt(chain, i);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 線分の連なりの、全体の長さ */
function chainLength(chain: Chain): number {
  let total = 0;
  for (let i = 0; i < segmentCount(chain); i++) total += segmentLength(chain, i);
  return total;
}

/** 位置 s までの、道に沿った長さ */
function lengthAlongChain(chain: Chain, s: number): number {
  const count = segmentCount(chain);
  const whole = Math.min(count, Math.max(0, Math.floor(s)));
  let total = 0;
  for (let i = 0; i < whole; i++) total += segmentLength(chain, i);
  if (whole < count) total += segmentLength(chain, whole) * (s - whole);
  return total;
}

/** 位置 s の点 */
export function chainPointAt(chain: Chain, s: number): Point2D {
  const count = segmentCount(chain);
  const i = Math.min(count - 1, Math.max(0, Math.floor(s)));
  const [a, b] = segmentAt(chain, i);
  const t = s - i;
  // 頂点の上は、計算せずに、頂点そのもの(丸め誤差を入れない)
  if (t <= 0) return a;
  if (t >= 1) return b;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * 位置 from〜to(to ≧ from。閉じた連なりでは、巻き込んで、length を超えてよい)の、頂点の並び。
 * startPoint・endPoint は、両端の座標(交点の座標をそのまま使うため)。無ければ、位置から求める。
 */
export function chainSlice(chain: Chain, from: number, to: number, startPoint: Point2D | null = null, endPoint: Point2D | null = null): Point2D[] {
  const n = chain.vertices.length;
  const points: Point2D[] = [];
  points.push(startPoint ?? chainPointAt(chain, ((from % segmentCount(chain)) + segmentCount(chain)) % segmentCount(chain)));
  // from と to の間にある頂点(整数の位置)を、順に足す
  for (let k = Math.floor(from + PARAM_EPSILON) + 1; k < to - PARAM_EPSILON; k++) {
    points.push(chain.vertices[((k % n) + n) % n]);
  }
  const count = segmentCount(chain);
  let endS = chain.closed ? ((to % count) + count) % count : to;
  // 閉じた連なりで、終わりが最初の頂点(count の整数倍)のときは、位置 0 ではなく、位置 count の点(同じ頂点)
  if (chain.closed && endS === 0 && to > 0) endS = count;
  points.push(endPoint ?? chainPointAt(chain, endS));
  return points;
}

// ---- 結果 ----

/** トリム・延長の結果。pieces は、対象の図形の代わりに残す図形(IDなし。呼び出し側が、IDなどを付ける) */
export type TrimResult =
  | { ok: true; pieces: CadEntity[] }
  | { ok: false; reason: string };

export const NO_INTERSECTION_REASON = "クリックした図形と交わる境界がありません";

export const sameStyle = <T extends CadEntity>(entity: T): Omit<T, "type"> => {
  const { type: _type, ...rest } = entity;
  void _type;
  return rest as Omit<T, "type">;
};

// ---- トリム ----

/**
 * 対象の図形を、境界(edges)で、クリックした位置 click の付近を切り取る。
 * 対象にできないものは、理由つきで ok: false。結果は、残る図形の一覧(0個なら、図形ごと無くなる)。
 */
export function trimEntity(target: CadEntity, click: Point2D, edges: readonly EdgePrimitive[]): TrimResult {
  if (target.type === "LINE" || target.type === "LWPOLYLINE" || target.type === "POLYLINE") {
    const chain = chainOf(target);
    const count = segmentCount(chain);
    if (count < 1) return { ok: false, reason: "線分がありません" };
    // 交点: 位置 s と、座標(座標は、そのまま使う。割合から計算し直すと、丸め誤差が入る)
    const hits: Array<{ s: number; point: Point2D }> = [];
    for (let i = 0; i < count; i++) {
      const [a, b] = segmentAt(chain, i);
      for (const edge of edges) {
        for (const hit of lineIntersections(a, b, edge)) {
          if (hit.t < -PARAM_EPSILON || hit.t > 1 + PARAM_EPSILON) continue;
          // 頂点の上の交点は、頂点そのもの(計算し直さない)
          const point = hit.t <= PARAM_EPSILON ? a : hit.t >= 1 - PARAM_EPSILON ? b : hit.point;
          hits.push({ s: i + Math.min(1, Math.max(0, hit.t)), point });
        }
      }
    }
    const intersections = hits.map((h) => h.s);
    // 位置 s にある交点の座標(同じ位置の交点が無ければ null)。閉じた連なりでは、count の位置は 0 と同じ
    const pointAtPosition = (s: number): Point2D | null => {
      for (const h of hits) {
        const difference = Math.abs(h.s - s);
        if (difference < PARAM_EPSILON || (chain.closed && Math.abs(difference - count) < PARAM_EPSILON)) return h.point;
      }
      return null;
    };
    const click_s = nearestChainPosition(chain, click);
    const keep = trimKeepIntervals(intersections, count, chain.closed, click_s);
    if (keep === null) return { ok: false, reason: chain.closed && intersections.length > 0 ? "閉じた図形は、交点が2つ以上ないと切り取れません" : NO_INTERSECTION_REASON };
    const pieces: CadEntity[] = [];
    for (const [from, to] of keep) {
      const points = chainSlice(chain, from, to, pointAtPosition(from), pointAtPosition(to));
      if (points.length < 2) continue;
      if (target.type === "LINE") {
        pieces.push({ ...target, start: points[0], end: points[points.length - 1] });
      } else {
        // 残る頂点は、元の頂点の図形をそのまま(値を含めて)、新しい端点は、座標だけ(chainSlice が、そう返す)
        pieces.push({ ...target, vertices: points, closed: false });
      }
    }
    return { ok: true, pieces };
  }

  if (target.type === "ARC" || target.type === "CIRCLE") {
    const circle = target;
    const span = target.type === "CIRCLE" ? TWO_PI : normalizeArcSpan(target.startAngle, target.endAngle);
    const start = target.type === "CIRCLE" ? 0 : target.startAngle;
    const intersections: number[] = [];
    for (const edge of edges) {
      for (const angle of circleIntersectionAngles(circle.center, circle.radius, edge)) {
        let s = ((angle - start) % TWO_PI + TWO_PI) % TWO_PI;
        // 始点のわずかに手前(丸め誤差)は、始点
        if (s > TWO_PI - ANGLE_EPSILON) s = 0;
        // 円弧は、範囲の中にあるものだけ。円は、全周
        if (target.type === "ARC" && s > span + ANGLE_EPSILON) continue;
        intersections.push(Math.min(s, span));
      }
    }
    const clickAngle = Math.atan2(click.y - circle.center.y, click.x - circle.center.x);
    let clickS = ((clickAngle - start) % TWO_PI + TWO_PI) % TWO_PI;
    if (target.type === "ARC" && clickS > span) {
      // 範囲の外(円弧の反対側)をクリックしたときは、近い方の端として扱う
      clickS = clickS - span < TWO_PI - clickS ? span : 0;
    }
    const keep = trimKeepIntervals(intersections, span, target.type === "CIRCLE", clickS);
    if (keep === null) return { ok: false, reason: target.type === "CIRCLE" && intersections.length > 0 ? "円は、交点が2つ以上ないと切り取れません" : NO_INTERSECTION_REASON };
    const pieces: CadEntity[] = [];
    for (const [from, to] of keep) {
      if (to - from <= ANGLE_EPSILON) continue;
      pieces.push({ ...sameStyle(target), type: "ARC", startAngle: normalizeAngleValue(start + from), endAngle: normalizeAngleValue(start + to) } as CadArc);
    }
    return { ok: true, pieces };
  }

  return { ok: false, reason: `${target.type} は、トリムできません(線・円弧・円・折れ線が対象です)` };
}

export function normalizeAngleValue(angle: number): number {
  const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  return wrapped;
}

// ---- 延長 ----

/**
 * 対象の図形の、クリックした位置に近い方の端を、最も近い境界まで延ばす。
 * 延ばせないもの(円・閉じた図形・境界が無い・端がすでに境界の上)は、理由つきで ok: false。
 */
export function extendEntity(target: CadEntity, click: Point2D, edges: readonly EdgePrimitive[]): TrimResult {
  if (target.type === "LINE" || ((target.type === "LWPOLYLINE" || target.type === "POLYLINE") && !target.closed)) {
    const chain = chainOf(target);
    const n = chain.vertices.length;
    if (n < 2) return { ok: false, reason: "線分がありません" };
    // どちらの端か: クリックに近い方(道に沿った長さで、真ん中より終点側なら終点。線分の数ではなく、長さで見る)
    const atEnd = lengthAlongChain(chain, nearestChainPosition(chain, click)) >= chainLength(chain) / 2;
    const tip = atEnd ? chain.vertices[n - 1] : chain.vertices[0];
    const neighbor = atEnd ? chain.vertices[n - 2] : chain.vertices[1];
    // 端の線分を、端の方向へ延ばした直線: neighbor → tip の向き。tip の位置は t = 1
    const moved = nearestForward(neighbor, tip, edges);
    if (moved === null) return { ok: false, reason: "延ばした先に、境界がありません" };
    if (target.type === "LINE") {
      return { ok: true, pieces: [atEnd ? { ...target, end: moved } : { ...target, start: moved }] };
    }
    const vertices = chain.vertices.slice();
    vertices[atEnd ? n - 1 : 0] = { ...vertices[atEnd ? n - 1 : 0], x: moved.x, y: moved.y };
    return { ok: true, pieces: [{ ...target, vertices }] };
  }

  if (target.type === "ARC") {
    const span = normalizeArcSpan(target.startAngle, target.endAngle);
    const gap = TWO_PI - span; // 円弧の外側の角度
    const clickAngle = Math.atan2(click.y - target.center.y, click.x - target.center.x);
    // クリックの、始点からの角度。円弧の中なら、真ん中より終点側=終点。円弧の外(反対側)なら、近い方の端(終点の先へ・始点の手前へ測った角度の小さい方)
    const relative = (((clickAngle - target.startAngle) % TWO_PI) + TWO_PI) % TWO_PI;
    const atEnd = relative <= span ? relative >= span / 2 : relative - span <= TWO_PI - relative;
    let best = Infinity;
    for (const edge of edges) {
      for (const angle of circleIntersectionAngles(target.center, target.radius, edge)) {
        // 端から、延ばす向きに測った角度(終点は反時計回り、始点は時計回り)
        const delta = atEnd ? (((angle - target.endAngle) % TWO_PI) + TWO_PI) % TWO_PI : (((target.startAngle - angle) % TWO_PI) + TWO_PI) % TWO_PI;
        // 円弧の中にある交点(延ばす先ではない)と、端そのものは、除く
        if (delta > ANGLE_EPSILON && delta < gap - ANGLE_EPSILON && delta < best) best = delta;
      }
    }
    if (!Number.isFinite(best)) return { ok: false, reason: "延ばした先に、境界がありません" };
    return {
      ok: true,
      pieces: [atEnd ? { ...target, endAngle: normalizeAngleValue(target.endAngle + best) } : { ...target, startAngle: normalizeAngleValue(target.startAngle - best) }],
    };
  }

  if (target.type === "CIRCLE") return { ok: false, reason: "円は、延長できません" };
  if (target.type === "LWPOLYLINE" || target.type === "POLYLINE") return { ok: false, reason: "閉じた図形は、延長できません" };
  return { ok: false, reason: `${target.type} は、延長できません(線・円弧・開いた折れ線が対象です)` };
}

/**
 * 点 from から to への直線を、to の先へ延ばしたとき、to を過ぎた最も近い境界との交点の座標。無ければ null。
 * to のすぐ上(t が 1 に近い)の交点は、すでに境界の上なので、延ばす先とは数えない。
 */
function nearestForward(from: Point2D, to: Point2D, edges: readonly EdgePrimitive[]): Point2D | null {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(length > 0)) return null;
  const minimum = 1 + COORD_EPSILON / length;
  let best: LineHit | null = null;
  for (const edge of edges) {
    for (const hit of lineIntersections(from, to, edge)) {
      if (hit.t > minimum && (best === null || hit.t < best.t)) best = hit;
    }
  }
  return best === null ? null : best.point;
}