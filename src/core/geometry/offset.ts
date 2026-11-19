// OFFSET(平行複写)の幾何の計算。画面にも図面データの保存にも依存しない純粋な処理。
//
// 対象: 線・円弧・円・折れ線(閉じたものを含む)。楕円・スプライン・文字・点は、対象外(理由つきで断る)。
// 側(side): 線・折れ線は、進行方向の左が +1・右が -1。円・円弧は、外側が +1・内側が -1。
//
// 折れ線: 各線分を距離だけ平行に動かし、隣り合う線分の交点で結ぶ(外側の角は、延ばして結ぶ。鋭すぎる角は面取り)。
// 内側へ動かして潰れた線分は外して結び直す。最後に、結果が正しいことを検証する(検証に通らなければ、壊れた形を作らずに断る):
//   (1) 結果の折れ線が、自分自身と交差しない
//   (2) 結果が、元の折れ線から、距離以上離れている(正しいオフセットは、元の図形から距離未満の所を通らない)
// 取り込んだ折れ線は、円弧の膨らみが展開済みの点列なので、点列の上で行う(真の円弧のオフセットとは、近似の分だけずれうる)。
import type { CadEntity, Point2D } from "../../types/cad";
import { MAX_RADIUS, MIN_RADIUS } from "./construct";

/** 外側の角を延ばして結ぶときの上限(角の頂点から結び目までの長さ ÷ 距離)。これを超える鋭い角は、面取りにする */
export const MITER_LIMIT = 10;
/** 座標(mm)の許容。これ以下の長さの線分・離れは、同じ点として扱う */
const COORD_EPSILON = 1e-9;

/** 側: 線・折れ線は、進行方向の左 +1・右 -1。円・円弧は、外側 +1・内側 -1 */
export type OffsetSide = 1 | -1;

export type OffsetResult = { ok: true; entity: CadEntity } | { ok: false; reason: string };

export const OFFSET_TYPES: ReadonlySet<CadEntity["type"]> = new Set(["LINE", "ARC", "CIRCLE", "LWPOLYLINE", "POLYLINE"]);

export const OFFSET_UNSUPPORTED_REASON = "線・円弧・円・折れ線だけが、オフセットできます";
export const OFFSET_COLLAPSE_REASON = "この距離ではオフセットできません(図形が重なる、または、消えてしまいます)";

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

// ---- 側と、通過点の距離 ----

/** 点から、線分への最短距離 */
function pointSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** 線分の連なり(線・折れ線)の、頂点と、閉じているか */
function chainOf(entity: CadEntity): { vertices: Point2D[]; closed: boolean } | null {
  if (entity.type === "LINE") return { vertices: [entity.start, entity.end], closed: false };
  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") return { vertices: entity.vertices, closed: entity.closed };
  return null;
}

/** 点に最も近い線分と、その線分の直線に対する点の符号つきの距離(左が正) */
function nearestSegmentSide(vertices: readonly Point2D[], closed: boolean, p: Point2D): { distance: number; signed: number } | null {
  const n = vertices.length;
  const count = closed ? n : n - 1;
  let best: { distance: number; signed: number } | null = null;
  for (let i = 0; i < count; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(length > 0)) continue;
    const distance = pointSegmentDistance(p, a, b);
    if (best === null || distance < best.distance) {
      best = { distance, signed: ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length };
    }
  }
  return best;
}

/**
 * クリックした点 point がある側。図形の上(側が決まらない)・対象外のときは null。
 * 線・折れ線は、いちばん近い線分から見て左(+1)か右(-1)。円・円弧は、外(+1)か内(-1)。
 */
export function offsetSideTowards(source: CadEntity, point: Point2D): OffsetSide | null {
  if (source.type === "CIRCLE" || source.type === "ARC") {
    const delta = Math.hypot(point.x - source.center.x, point.y - source.center.y) - source.radius;
    if (!Number.isFinite(delta) || Math.abs(delta) <= COORD_EPSILON * Math.max(1, source.radius)) return null;
    return delta > 0 ? 1 : -1;
  }
  const chain = chainOf(source);
  if (chain === null) return null;
  const nearest = nearestSegmentSide(chain.vertices, chain.closed, point);
  if (nearest === null || !Number.isFinite(nearest.signed) || Math.abs(nearest.signed) <= COORD_EPSILON) return null;
  return nearest.signed > 0 ? 1 : -1;
}

/**
 * 通過点 point を通るオフセットの、距離と側(OFFSET の T)。
 * 線: 点を通る平行線(直線までの垂直距離)。円・円弧: 点を通る同心の円・円弧(中心からの距離 − 半径)。折れ線: 折れ線から点までの最短距離。
 * 点が図形の上(距離 0)・対象外のときは null。
 */
export function offsetThroughPoint(source: CadEntity, point: Point2D): { distance: number; side: OffsetSide } | null {
  if (source.type === "CIRCLE" || source.type === "ARC") {
    const delta = Math.hypot(point.x - source.center.x, point.y - source.center.y) - source.radius;
    if (!Number.isFinite(delta) || Math.abs(delta) <= COORD_EPSILON * Math.max(1, source.radius)) return null;
    return { distance: Math.abs(delta), side: delta > 0 ? 1 : -1 };
  }
  const chain = chainOf(source);
  if (chain === null) return null;
  const nearest = nearestSegmentSide(chain.vertices, chain.closed, point);
  if (nearest === null || !Number.isFinite(nearest.signed) || Math.abs(nearest.signed) <= COORD_EPSILON) return null;
  const side: OffsetSide = nearest.signed > 0 ? 1 : -1;
  // 線は、直線までの垂直距離(線分の外でも、平行線が点を通る)。折れ線は、最短距離
  const distance = source.type === "LINE" ? Math.abs(nearest.signed) : nearest.distance;
  return { distance, side };
}

// ---- 結果の形 ----

/** 結果の図形(IDと元データとの対応は、呼び出し側が付ける) */
export function offsetEntity(source: CadEntity, distance: number, side: OffsetSide): OffsetResult {
  if (!OFFSET_TYPES.has(source.type)) return fail(`${source.type} は、オフセットできません(${OFFSET_UNSUPPORTED_REASON})`);
  if (!(distance > 0) || !Number.isFinite(distance)) return fail("距離は、0 より大きい数にしてください");

  if (source.type === "CIRCLE" || source.type === "ARC") {
    const radius = source.radius + side * distance;
    if (!Number.isFinite(radius)) return fail("結果の座標が正しくありません");
    if (side < 0 && radius < MIN_RADIUS) return fail("距離が半径以上のため、内側へはオフセットできません");
    if (radius > MAX_RADIUS) return fail("結果の半径が大きすぎます");
    return { ok: true, entity: { ...source, radius } };
  }

  if (source.type === "LINE") {
    const dx = source.end.x - source.start.x;
    const dy = source.end.y - source.start.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0) || !Number.isFinite(length)) return fail("長さ 0 の線は、オフセットできません");
    // 左の法線 = (-dy, dx) / length。水平・垂直の線は、法線の成分がちょうど 0 か ±1 になり、座標がぴったりになる
    const ox = (-dy / length) * distance * side;
    const oy = (dx / length) * distance * side;
    const entity: CadEntity = {
      ...source,
      start: { x: source.start.x + ox, y: source.start.y + oy },
      end: { x: source.end.x + ox, y: source.end.y + oy },
    };
    return finite(entity) ? { ok: true, entity } : fail("結果の座標が正しくありません");
  }

  // 折れ線
  const polyline = source as Extract<CadEntity, { type: "LWPOLYLINE" | "POLYLINE" }>;
  const result = offsetChain(polyline.vertices, polyline.closed, distance, side);
  if (typeof result === "string") return fail(result);
  const entity: CadEntity = { ...polyline, vertices: result };
  return finite(entity) ? { ok: true, entity } : fail("結果の座標が正しくありません");
}

function finite(entity: CadEntity): boolean {
  if (entity.type === "LINE") return [entity.start.x, entity.start.y, entity.end.x, entity.end.y].every(Number.isFinite);
  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") return entity.vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
  return true;
}

// ---- 折れ線のオフセット ----

type Segment = {
  a: Point2D;
  b: Point2D;
  /** 単位の方向 */
  ux: number;
  uy: number;
  length: number;
  /** 動かした線の始点(a + δ·法線) */
  ox: number;
  oy: number;
};

/** 隣り合う線分の結び目。end は前の線分の終わり、start は次の線分の始まり(面取りのときは、2点で、違う点) */
type Joint = { end: Point2D; start: Point2D };

const sameDistance = (p: Point2D, q: Point2D): boolean => Math.hypot(p.x - q.x, p.y - q.y) <= COORD_EPSILON;

/** 続く同じ点を1つにする(閉じていれば、最後と最初も) */
function dedupe(points: readonly Point2D[], closed: boolean): Point2D[] {
  const result: Point2D[] = [];
  for (const p of points) {
    if (result.length === 0 || !sameDistance(result[result.length - 1], p)) result.push(p);
  }
  if (closed) while (result.length > 1 && sameDistance(result[0], result[result.length - 1])) result.pop();
  return result;
}

function buildSegments(points: readonly Point2D[], closed: boolean, delta: number): Segment[] {
  const n = points.length;
  const count = closed ? n : n - 1;
  const segments: Segment[] = [];
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    // 左の法線 = (-uy, ux)。delta は側の符号つき
    segments.push({ a, b, ux, uy, length, ox: a.x + -uy * delta, oy: a.y + ux * delta });
  }
  return segments;
}

/** 動かした2本の直線の結び目 */
function jointOf(s: Segment, t: Segment, delta: number, distance: number): Joint {
  const endS: Point2D = { x: s.b.x + -s.uy * delta, y: s.b.y + s.ux * delta };
  const startT: Point2D = { x: t.ox, y: t.oy };
  const cross = s.ux * t.uy - s.uy * t.ux;
  if (Math.abs(cross) <= 1e-12) {
    // 平行。同じ向きなら、そのまま1点。逆向き(折り返し)なら、面取り
    return s.ux * t.ux + s.uy * t.uy > 0 ? { end: endS, start: endS } : { end: endS, start: startT };
  }
  // 直線 s(動かしたもの)と t の交点
  const k = ((t.ox - s.ox) * t.uy - (t.oy - s.oy) * t.ux) / cross;
  let x = s.ox + s.ux * k;
  let y = s.oy + s.uy * k;
  // 水平・垂直の線は、その座標がぴったりの値(割合から計算し直すと丸め誤差が入る)
  if (s.ux === 0) x = s.ox;
  if (s.uy === 0) y = s.oy;
  if (t.ux === 0) x = t.ox;
  if (t.uy === 0) y = t.oy;
  const m = { x, y };
  // 外側の角(曲がる向きと、動かす向きが逆)で、結び目が遠すぎるなら、先端を、頂点から 上限×距離 の所で、角の二等分線に垂直に切る(面取り)。
  // 2つの端点を直接結ぶと、折り返しに近い角で、頂点のすぐそばを通ってしまうため
  const outside = cross * delta < 0;
  const reach = Math.hypot(x - s.b.x, y - s.b.y);
  const limit = MITER_LIMIT * distance;
  if (outside && reach > limit) {
    const wx = (x - s.b.x) / reach;
    const wy = (y - s.b.y) / reach;
    // 動かした直線の端点の、二等分線の方向の位置(頂点から)。s も t も同じ
    const base = (endS.x - s.b.x) * wx + (endS.y - s.b.y) * wy;
    const f = (limit - base) / (reach - base);
    if (!(f > 0 && f < 1)) return { end: endS, start: startT };
    return {
      end: { x: endS.x + (x - endS.x) * f, y: endS.y + (y - endS.y) * f },
      start: { x: startT.x + (x - startT.x) * f, y: startT.y + (y - startT.y) * f },
    };
  }
  return { end: m, start: m };
}

/**
 * 折れ線の頂点をオフセットした頂点列。失敗のときは、理由の文字列。
 * @param side 左が +1・右が -1
 */
function offsetChain(vertices: readonly Point2D[], closed: boolean, distance: number, side: OffsetSide): Point2D[] | string {
  const source = dedupe(vertices, closed);
  if (source.length < (closed ? 3 : 2)) return "線分がありません";
  if (!source.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return "図形の座標が正しくありません";
  const delta = side * distance;
  const all = buildSegments(source, closed, delta);

  // 内側へ動かして潰れた線分(向きが逆になる・長さ 0)を外して、結び直す。外れる線分が無くなるまで繰り返す
  let active = all;
  let joints: Joint[] = [];
  for (let round = 0; ; round++) {
    const minimum = closed ? 3 : 1;
    if (active.length < minimum) return OFFSET_COLLAPSE_REASON;
    joints = [];
    const jointCount = closed ? active.length : active.length - 1;
    for (let i = 0; i < jointCount; i++) joints.push(jointOf(active[i], active[(i + 1) % active.length], delta, distance));
    const survivors: Segment[] = [];
    for (let i = 0; i < active.length; i++) {
      const segment = active[i];
      const start: Point2D = closed || i > 0 ? joints[(i - 1 + active.length) % active.length].start : { x: segment.ox, y: segment.oy };
      const end: Point2D =
        closed || i < active.length - 1
          ? joints[i].end
          : { x: segment.b.x + -segment.uy * delta, y: segment.b.y + segment.ux * delta };
      // 元の向きに、進んでいる長さ
      const along = (end.x - start.x) * segment.ux + (end.y - start.y) * segment.uy;
      if (along > COORD_EPSILON) survivors.push(segment);
    }
    if (survivors.length === active.length) break;
    if (round > all.length) return OFFSET_COLLAPSE_REASON;
    active = survivors;
  }

  // 頂点列にする
  const points: Point2D[] = [];
  if (closed) {
    // 最後の線分と最初の線分の結び目(= 頂点 0 の結果)から始める。元の頂点との対応が、順に保たれる
    for (let k = 0; k < joints.length; k++) {
      const joint = joints[(k + joints.length - 1) % joints.length];
      points.push(joint.end);
      if (joint.start !== joint.end) points.push(joint.start);
    }
  } else {
    const first = active[0];
    points.push({ x: first.ox, y: first.oy });
    for (const joint of joints) {
      points.push(joint.end);
      if (joint.start !== joint.end) points.push(joint.start);
    }
    const last = active[active.length - 1];
    points.push({ x: last.b.x + -last.uy * delta, y: last.b.y + last.ux * delta });
  }
  const result = dedupe(points, closed);
  if (result.length < (closed ? 3 : 2)) return OFFSET_COLLAPSE_REASON;

  // 検証。通らなければ、壊れた形を作らずに断る
  if (!result.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return "結果の座標が正しくありません";
  if (selfIntersects(result, closed)) return OFFSET_COLLAPSE_REASON;
  if (hasPointCloserThan(result, closed, source, distance)) return OFFSET_COLLAPSE_REASON;
  return result;
}

// ---- 検証 ----

/** 線分の格子(近くの線分だけを調べるための索引) */
class SegmentGrid {
  private readonly cells = new Map<string, number[]>();
  /** 格子に収まらないほど長い線分(すべての問い合わせで調べる) */
  private readonly wide: number[] = [];
  private readonly stamp: Int32Array;
  private queryId = 0;
  private readonly segments: ReadonlyArray<readonly [Point2D, Point2D]>;
  private readonly cell: number;
  private readonly originX: number;
  private readonly originY: number;

  constructor(segments: ReadonlyArray<readonly [Point2D, Point2D]>, cell: number) {
    this.segments = segments;
    // 格子の番号は、図形の左下(最小の座標)からの距離で数える。絶対座標で数えると、座標が大きい図形(1e20 など)で、番号が 2^53 を超え、
    // 番号を1つ進める操作(x++)が効かず、ループが終わらない。幅も、絶対座標ではなく、図形の広がり ÷ 1e9 以上に保つ
    // (座標が大きいだけの図形で、幅が広がって、細かい線分が同じ升に集まり、遅くならないように)
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [a, b] of segments) {
      minX = Math.min(minX, a.x, b.x);
      maxX = Math.max(maxX, a.x, b.x);
      minY = Math.min(minY, a.y, b.y);
      maxY = Math.max(maxY, a.y, b.y);
    }
    this.originX = Number.isFinite(minX) ? minX : 0;
    this.originY = Number.isFinite(minY) ? minY : 0;
    const extent = Math.max(maxX - minX, maxY - minY);
    const widened = Math.max(cell, Number.isFinite(extent) ? extent / 1e9 : 0);
    this.cell = Number.isFinite(widened) && widened > 0 ? widened : 1;
    this.stamp = new Int32Array(segments.length);
    segments.forEach(([a, b], i) => {
      const [x0, x1, y0, y1] = this.range(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) {
        this.wide.push(i);
        return;
      }
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const list = this.cells.get(key);
          if (list === undefined) this.cells.set(key, [i]);
          else list.push(i);
        }
      }
    });
  }

  private range(minX: number, maxX: number, minY: number, maxY: number): [number, number, number, number] {
    return [
      Math.floor((minX - this.originX) / this.cell),
      Math.floor((maxX - this.originX) / this.cell),
      Math.floor((minY - this.originY) / this.cell),
      Math.floor((maxY - this.originY) / this.cell),
    ];
  }

  /** 範囲に触れうる線分の番号を、1回ずつ渡す。visit が true を返したら、そこで止める(戻り値も true) */
  query(minX: number, maxX: number, minY: number, maxY: number, visit: (index: number) => boolean): boolean {
    const id = ++this.queryId;
    const once = (index: number): boolean => {
      if (this.stamp[index] === id) return false;
      this.stamp[index] = id;
      return visit(index);
    };
    for (const index of this.wide) if (once(index)) return true;
    const [x0, x1, y0, y1] = this.range(minX, maxX, minY, maxY);
    // 範囲が広い、または、番号が安全な整数の範囲を超える(非有限を含む): すべての線分を調べる(番号を進めるループに入らない)
    const safe = Math.abs(x0) <= 2 ** 50 && Math.abs(x1) <= 2 ** 50 && Math.abs(y0) <= 2 ** 50 && Math.abs(y1) <= 2 ** 50;
    if (!safe || (x1 - x0 + 1) * (y1 - y0 + 1) > 64) {
      // 範囲が広い: すべての線分を調べる
      for (let i = 0; i < this.segments.length; i++) if (once(i)) return true;
      return false;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = this.cells.get(`${x},${y}`);
        if (list === undefined) continue;
        for (const index of list) if (once(index)) return true;
      }
    }
    return false;
  }
}

function segmentsOf(points: readonly Point2D[], closed: boolean): Array<[Point2D, Point2D]> {
  const n = points.length;
  const count = closed ? n : n - 1;
  const result: Array<[Point2D, Point2D]> = [];
  for (let i = 0; i < count; i++) result.push([points[i], points[(i + 1) % n]]);
  return result;
}

function cellSizeOf(segments: ReadonlyArray<readonly [Point2D, Point2D]>, floor: number): number {
  let total = 0;
  for (const [a, b] of segments) total += Math.hypot(b.x - a.x, b.y - a.y);
  const average = segments.length > 0 ? total / segments.length : 0;
  const size = Math.max(floor, average);
  return Number.isFinite(size) && size > 0 ? size : 1;
}

const cross = (o: Point2D, a: Point2D, b: Point2D): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** 2本の線分が、交わる(端が触れる・重なるを含む)か */
function segmentsTouch(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const onSegment = (p: Point2D, q: Point2D, r: Point2D, value: number): boolean =>
    value === 0 && r.x >= Math.min(p.x, q.x) && r.x <= Math.max(p.x, q.x) && r.y >= Math.min(p.y, q.y) && r.y <= Math.max(p.y, q.y);
  return onSegment(a, b, c, d1) || onSegment(a, b, d, d2) || onSegment(c, d, a, d3) || onSegment(c, d, b, d4);
}

/** 線分と線分の最短距離(交わっていれば 0) */
function segmentDistance(a: Point2D, b: Point2D, c: Point2D, d: Point2D): number {
  if (segmentsTouch(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** 折れ線が、自分自身と(隣り合う線分以外で)交わるか */
export function selfIntersects(points: readonly Point2D[], closed: boolean): boolean {
  const segments = segmentsOf(points, closed);
  // 隣り合う線分は、端を共有するだけなら問題ない。逆向きに折り返して重なるものは、断る
  const adjacentPairs = closed ? segments.length : segments.length - 1;
  for (let i = 0; i < adjacentPairs; i++) {
    const [a, b] = segments[i];
    const [c, d] = segments[(i + 1) % segments.length];
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = d.x - c.x;
    const vy = d.y - c.y;
    const scale = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (scale > 0 && Math.abs(ux * vy - uy * vx) <= 1e-9 * scale && ux * vx + uy * vy < 0) return true;
  }
  if (segments.length < 3) return false;
  const grid = new SegmentGrid(segments, cellSizeOf(segments, 0));
  const last = segments.length - 1;
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    const hit = grid.query(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y), (j) => {
      if (j <= i) return false; // 組は1回だけ
      if (j === i + 1 || (closed && i === 0 && j === last)) return false; // 隣り合う線分(端を共有する)
      return segmentsTouch(a, b, segments[j][0], segments[j][1]);
    });
    if (hit) return true;
  }
  return false;
}

/**
 * 連なりの順に並んだ線分の、範囲の木(隣り合う線分は、近くにあることが多いので、連なりの順に二分する)。
 * 「ある線分から、距離 limit 未満の所にある線分が、あるか」を、遠い枝を飛ばして調べる。
 * (格子だと、細かい点列(取り込んだ円弧)で、距離の内側に何千本も入り、10万頂点で数十秒かかる)
 */
type TreeNode = { minX: number; minY: number; maxX: number; maxY: number; lo: number; hi: number; left: TreeNode | null; right: TreeNode | null };

const TREE_LEAF_SIZE = 6;

function buildTree(segments: ReadonlyArray<readonly [Point2D, Point2D]>, lo: number, hi: number): TreeNode {
  if (hi - lo <= TREE_LEAF_SIZE) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = lo; i < hi; i++) {
      const [a, b] = segments[i];
      minX = Math.min(minX, a.x, b.x);
      maxX = Math.max(maxX, a.x, b.x);
      minY = Math.min(minY, a.y, b.y);
      maxY = Math.max(maxY, a.y, b.y);
    }
    return { minX, minY, maxX, maxY, lo, hi, left: null, right: null };
  }
  const mid = (lo + hi) >> 1;
  const left = buildTree(segments, lo, mid);
  const right = buildTree(segments, mid, hi);
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
    lo,
    hi,
    left,
    right,
  };
}

/** 線分(a, b)から、距離 limit 未満の線分が、木の中にあるか */
function treeHasSegmentCloserThan(node: TreeNode, segments: ReadonlyArray<readonly [Point2D, Point2D]>, a: Point2D, b: Point2D, limit: number): boolean {
  // 線分の範囲と、枝の範囲の、すきま
  const gapX = Math.max(0, Math.min(a.x, b.x) - node.maxX, node.minX - Math.max(a.x, b.x));
  const gapY = Math.max(0, Math.min(a.y, b.y) - node.maxY, node.minY - Math.max(a.y, b.y));
  if (Math.hypot(gapX, gapY) >= limit) return false;
  if (node.left === null || node.right === null) {
    for (let i = node.lo; i < node.hi; i++) {
      if (segmentDistance(a, b, segments[i][0], segments[i][1]) < limit) return true;
    }
    return false;
  }
  return treeHasSegmentCloserThan(node.left, segments, a, b, limit) || treeHasSegmentCloserThan(node.right, segments, a, b, limit);
}

/** 結果の線分のうち、元の折れ線から、距離未満の所を通るものがあるか */
function hasPointCloserThan(result: readonly Point2D[], closed: boolean, source: readonly Point2D[], distance: number): boolean {
  const sourceSegments = segmentsOf(source, closed);
  const resultSegments = segmentsOf(result, closed);
  if (sourceSegments.length === 0) return false;
  let magnitude = 0;
  for (const p of source) magnitude = Math.max(magnitude, Math.abs(p.x), Math.abs(p.y));
  for (const p of result) magnitude = Math.max(magnitude, Math.abs(p.x), Math.abs(p.y));
  // 丸め誤差の許容: 距離に比例する分と、座標の大きさに比例する分
  const tolerance = distance * 1e-6 + 1e-9 + magnitude * 1e-14;
  // 許容が距離の半分以上になるほど、座標が大きい(または距離が小さい)ときは、距離を検証できない。通さずに、断る(検証が素通りしないように)
  if (tolerance >= distance * 0.5) return true;
  const limit = distance - tolerance;
  const tree = buildTree(sourceSegments, 0, sourceSegments.length);
  for (const [a, b] of resultSegments) {
    if (treeHasSegmentCloserThan(tree, sourceSegments, a, b, limit)) return true;
  }
  return false;
}
