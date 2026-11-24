// FILLET(角の丸め)・CHAMFER(角の面取り)の幾何の計算。画面にも図面データの保存にも依存しない純粋な処理。
//
// 対象(Phase 13): 線(LINE)と折れ線だけ。円弧・円が絡む組み合わせは断る。
//   - 別々の2本の線: 2本の線(延ばした直線)の交点を角にして、クリックした側の腕を残す。腕は、接点まで短く(または延ばし)する。
//   - 1本の折れ線の、隣り合う2本の線分: その間の頂点を、円弧(点列で近似)・斜めの線に置き換える。
//   - 折れ線と別の図形、別々の折れ線どうしは断る(仕様外)。
// 取り込んだ折れ線は、円弧の膨らみが展開済みの点列なので、折れ線の円弧は点列(弦の誤差 ≦ 半径の 1e-4 倍)にする。
//
// 結果の考え方: replaced = 対象の図形の代わりに残す図形(IDを保つ)。added = 新しく足す図形(円弧・面取りの線。
// 属性(レイヤー・色・線種・太さ)は1つ目の図形と同じ。id・sourceRecord は意味を持たない。呼び出し側が付け直す)。
import type { CadArc, CadEntity, CadLine, CadPolyline, Point2D } from "../../types/cad";
import { chainOf, normalizeAngleValue, sameStyle, segmentAt, segmentCount } from "./trim";
import type { Chain } from "./trim";

/** FILLET・CHAMFER の対象にできる図形の種類 */
export const FILLET_TYPES: ReadonlySet<CadEntity["type"]> = new Set<CadEntity["type"]>(["LINE", "LWPOLYLINE", "POLYLINE"]);

/** 折れ線の円弧を点列にするときの、弦の誤差(半径に対する割合)の上限。90°で約 56 本の線分になる */
export const ARC_CHORD_ERROR = 1e-4;
const MAX_ARC_STEP = 2 * Math.acos(1 - ARC_CHORD_ERROR);

/** 2本の線のなす角の sin がこれ以下なら、平行(角が無い)として断る */
const PARALLEL_EPSILON = 1e-9;
/** 接点が、線の端(や、頂点)とほぼ同じ位置のとき、同じとみなす(長さに対する割合) */
const LENGTH_SLACK = 1e-9;
/** 円弧の点が、中心から半径だけ離れていることの確認の許容(半径に対する割合)。座標の桁が大きすぎて、丸め落ちた結果を断る */
const RADIUS_TOLERANCE = 1e-6;

export type CornerMode =
  | { kind: "fillet"; radius: number }
  /** distance1 は1つ目に選んだ図形の上、distance2 は2つ目に選んだ図形の上の、角からの距離 */
  | { kind: "chamfer"; distance1: number; distance2: number };

export type CornerResult =
  | { ok: true; replaced: CadEntity[]; added: CadEntity[] }
  | { ok: false; reason: string };

export const CORNER_PARALLEL_REASON = "2本の線が平行(または一直線上)なので、角がありません";
export const CORNER_SAME_LINE_REASON = "同じ線を2回指しています。別の線を指してください";
export const CORNER_SAME_SEGMENT_REASON = "同じ線分を2回指しています。隣り合う別の線分を指してください";
export const CORNER_NOT_ADJACENT_REASON = "折れ線は、隣り合う2本の線分だけ、角を処理できます(離れた線分は、処理できません)";
export const CORNER_MIXED_REASON = "折れ線は、同じ折れ線の隣り合う2本の線分だけ処理できます(別の図形との組み合わせは、処理できません)";
export const CORNER_AMBIGUOUS_SIDE_REASON = "どちら側の線を残すか決まりません(交点から離れた所をクリックしてください)";
export const CORNER_NOTHING_CHANGES_REASON = "半径(距離)が 0 のとき、隣り合う線分は、すでに角でつながっているので、変わりません";
export const CORNER_UNCOMPUTABLE_REASON = "結果の座標が計算できません";
export const CORNER_PRECISION_REASON = "座標の桁に比べて、半径(距離)が小さすぎるため、結果を正確に作れません";

const fmt = (value: number): string => String(Number(value.toPrecision(6)));
const fail = (reason: string): CornerResult => ({ ok: false, reason });

/** 値の確認: 半径・距離は、0 以上の有限の数。面取りは、2つとも 0、または2つとも 0 より大きい(片方だけ 0 にはできない) */
export function validateCornerMode(mode: CornerMode): string | null {
  if (mode.kind === "fillet") {
    if (!Number.isFinite(mode.radius) || mode.radius < 0) return "半径は、0 以上の数にしてください";
    return null;
  }
  if (!Number.isFinite(mode.distance1) || !Number.isFinite(mode.distance2) || mode.distance1 < 0 || mode.distance2 < 0) return "距離は、0 以上の数にしてください";
  if ((mode.distance1 === 0) !== (mode.distance2 === 0)) return "距離は、2つとも 0、または2つとも 0 より大きい数にしてください(片方だけ 0 にはできません)";
  return null;
}

/** 角から接点までの距離が 0(角を作るだけ)か */
function isZeroMode(mode: CornerMode): boolean {
  return mode.kind === "fillet" ? mode.radius === 0 : mode.distance1 === 0 && mode.distance2 === 0;
}

const isFinitePoint = (p: Point2D): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** 角の内側の角度 θ(0〜π)。u1・u2 は、角から、それぞれの腕へ向かう単位ベクトル */
function interiorAngle(u1: Point2D, u2: Point2D): { theta: number; sin: number; cos: number } {
  const sin = Math.abs(u1.x * u2.y - u1.y * u2.x);
  const cos = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
  return { theta: Math.atan2(sin, cos), sin, cos };
}

/** 角から接点までの距離(1つ目・2つ目の腕の上の距離) */
function tangentDistances(mode: CornerMode, angle: { sin: number; cos: number }): { d1: number; d2: number } {
  if (mode.kind === "chamfer") return { d1: mode.distance1, d2: mode.distance2 };
  // t = r / tan(θ/2) = r (1 + cos θ) / sin θ。直角(長方形の角)で、半径ちょうどになる形(tan を使うと、丸め誤差が出る)
  const t = (mode.radius * (1 + angle.cos)) / angle.sin;
  return { d1: t, d2: t };
}

/** 距離 distance が、腕の長さ available に収まるか(端とほぼ同じ位置は、収まる) */
function fits(distance: number, available: number): boolean {
  return distance <= available * (1 + LENGTH_SLACK);
}

function tooLongReason(mode: CornerMode, distance: number, available: number, what: string): string {
  return mode.kind === "fillet"
    ? `半径が大きすぎます(角から接点まで ${fmt(distance)} が、${what}の長さ ${fmt(available)} を超えます)`
    : `距離が長すぎます(${fmt(distance)} が、${what}の長さ ${fmt(available)} を超えます)`;
}

// ---- 別々の2本の線 ----

type Arm = {
  /** 交点から、残す腕へ向かう単位ベクトル */
  u: Point2D;
  /** 交点から、遠い方の端までの長さ(u の向き) */
  far: number;
  /** 遠い方の端が、終点か(false なら始点) */
  farIsEnd: boolean;
};

/** 線 line の、交点 x から残す腕(クリック click の側)を決める。決まらないときは null */
function armOf(line: CadLine, click: Point2D, x: Point2D, length: number): Arm | null {
  const ex = (line.end.x - line.start.x) / length;
  const ey = (line.end.y - line.start.y) / length;
  const along = (click.x - x.x) * ex + (click.y - x.y) * ey;
  // クリックの位置が、交点とほぼ同じ(どちら側か決まらない)
  if (!Number.isFinite(along) || !(Math.abs(along) > LENGTH_SLACK * length)) return null;
  const sign = along > 0 ? 1 : -1;
  const u = { x: ex * sign, y: ey * sign };
  const startAlong = (line.start.x - x.x) * u.x + (line.start.y - x.y) * u.y;
  const endAlong = (line.end.x - x.x) * u.x + (line.end.y - x.y) * u.y;
  return { u, far: Math.max(startAlong, endAlong), farIsEnd: endAlong >= startAlong };
}

function lineCorner(a: CadLine, clickA: Point2D, b: CadLine, clickB: Point2D, mode: CornerMode): CornerResult {
  const d1x = a.end.x - a.start.x;
  const d1y = a.end.y - a.start.y;
  const d2x = b.end.x - b.start.x;
  const d2y = b.end.y - b.start.y;
  const length1 = Math.hypot(d1x, d1y);
  const length2 = Math.hypot(d2x, d2y);
  if (!(length1 > 0) || !(length2 > 0) || !Number.isFinite(length1) || !Number.isFinite(length2)) return fail("長さが 0 の線は、角を処理できません");
  // 向きは単位ベクトルで扱う(長さの積が、桁あふれ・0 に潰れるのを避ける)
  const e1 = { x: d1x / length1, y: d1y / length1 };
  const e2 = { x: d2x / length2, y: d2y / length2 };
  const cross = e1.x * e2.y - e1.y * e2.x;
  if (!(Math.abs(cross) > PARALLEL_EPSILON)) return fail(CORNER_PARALLEL_REASON);

  // 交点(延ばした直線どうしの交点)。垂直・水平の線は、その座標をそのまま使う(割合から計算し直すと、丸め誤差が入る)
  const s = ((b.start.x - a.start.x) * e2.y - (b.start.y - a.start.y) * e2.x) / cross;
  const x: Point2D = {
    x: e2.x === 0 ? b.start.x : e1.x === 0 ? a.start.x : a.start.x + e1.x * s,
    y: e2.y === 0 ? b.start.y : e1.y === 0 ? a.start.y : a.start.y + e1.y * s,
  };
  if (!isFinitePoint(x)) return fail(CORNER_UNCOMPUTABLE_REASON);

  const armA = armOf(a, clickA, x, length1);
  const armB = armOf(b, clickB, x, length2);
  if (armA === null || armB === null) return fail(CORNER_AMBIGUOUS_SIDE_REASON);

  const angle = interiorAngle(armA.u, armB.u);
  const { d1, d2 } = isZeroMode(mode) ? { d1: 0, d2: 0 } : tangentDistances(mode, angle);
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return fail(CORNER_UNCOMPUTABLE_REASON);
  // 残る長さが 0 以下(線の長さが足りない)なら断る。線の端とぴったり同じ位置の接点も、長さ 0 の線になるので断る
  for (const [distance, arm] of [[d1, armA], [d2, armB]] as const) {
    if (!(arm.far - distance > LENGTH_SLACK * Math.max(arm.far, distance))) return fail(tooLongReason(mode, distance, arm.far, "線"));
  }

  const tangent1 = d1 === 0 ? x : { x: x.x + armA.u.x * d1, y: x.y + armA.u.y * d1 };
  const tangent2 = d2 === 0 ? x : { x: x.x + armB.u.x * d2, y: x.y + armB.u.y * d2 };
  if (!isFinitePoint(tangent1) || !isFinitePoint(tangent2)) return fail(CORNER_UNCOMPUTABLE_REASON);

  // 腕の根元(角の側の端)を、接点に動かす。向き(始点・終点)は、元のまま
  const shortened = (line: CadLine, arm: Arm, point: Point2D): CadLine => (arm.farIsEnd ? { ...line, start: point } : { ...line, end: point });
  const replaced: CadEntity[] = [shortened(a, armA, tangent1), shortened(b, armB, tangent2)];

  if (isZeroMode(mode)) return { ok: true, replaced, added: [] };

  // 接点が同じ位置に潰れる(座標の桁に比べて、距離が小さすぎる)と、長さ 0 の線・中心の無い円弧ができるので、断る
  if (tangent1.x === tangent2.x && tangent1.y === tangent2.y) return fail(CORNER_PRECISION_REASON);

  if (mode.kind === "chamfer") {
    const connector: CadLine = { ...sameStyle(a), type: "LINE", start: tangent1, end: tangent2 } as CadLine;
    return { ok: true, replaced, added: [connector] };
  }

  // 円弧: 中心は、接点1から、線1に垂直に、線2の側へ、半径だけ離れた所
  let nx = -armA.u.y;
  let ny = armA.u.x;
  if (nx * armB.u.x + ny * armB.u.y < 0) {
    nx = -nx;
    ny = -ny;
  }
  const center = { x: tangent1.x + nx * mode.radius, y: tangent1.y + ny * mode.radius };
  if (!isFinitePoint(center)) return fail(CORNER_UNCOMPUTABLE_REASON);
  // 2つの接点が、中心から半径だけ離れていること(座標の桁が大きく、丸め落ちて、半径・接線の条件が崩れた結果を断る)
  for (const tangent of [tangent1, tangent2]) {
    if (!(Math.abs(Math.hypot(tangent.x - center.x, tangent.y - center.y) - mode.radius) <= RADIUS_TOLERANCE * mode.radius)) return fail(CORNER_PRECISION_REASON);
  }
  const angle1 = Math.atan2(tangent1.y - center.y, tangent1.x - center.x);
  const angle2 = Math.atan2(tangent2.y - center.y, tangent2.x - center.x);
  // 反時計回りで、短い方(掃引 π − θ < π)の円弧: 接点1 → 接点2 が反時計回りなら、その順
  const counterClockwise = (tangent1.x - center.x) * (tangent2.y - center.y) - (tangent1.y - center.y) * (tangent2.x - center.x) > 0;
  const startAngle = normalizeAngleValue(counterClockwise ? angle1 : angle2);
  const endAngle = normalizeAngleValue(counterClockwise ? angle2 : angle1);
  const arc: CadArc = { ...sameStyle(a), type: "ARC", center, radius: mode.radius, startAngle, endAngle } as CadArc;
  return { ok: true, replaced, added: [arc] };
}

// ---- 1本の折れ線の、隣り合う2本の線分 ----

/**
 * クリックに最も近い線分の番号(同じ距離なら、番号の小さい方)。求められないとき(座標が桁あふれ)は -1。
 * 長さの二乗・距離の二乗は、座標が 1e154 を超えると桁あふれするので、大きい方の成分で割って射影し、距離は hypot で求める。
 */
function nearestSegmentIndex(chain: Chain, point: Point2D): number {
  let best = Infinity;
  let bestIndex = -1;
  for (let i = 0; i < segmentCount(chain); i++) {
    const [p, q] = segmentAt(chain, i);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const scale = Math.max(Math.abs(dx), Math.abs(dy));
    let t = 0;
    if (scale > 0) {
      const ux = dx / scale;
      const uy = dy / scale;
      t = Math.min(1, Math.max(0, (((point.x - p.x) / scale) * ux + ((point.y - p.y) / scale) * uy) / (ux * ux + uy * uy)));
    }
    const distance = Math.hypot(point.x - (p.x + dx * t), point.y - (p.y + dy * t));
    // 距離が求められない線分(長さが桁あふれ)があると、その線分を黙って飛ばして、別の線分を選んでしまうので、全体を断る
    if (Number.isNaN(distance)) return -1;
    if (distance < best) {
      best = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/** 角 v(手前の頂点 p・次の頂点 q の間)を、円弧に置き換える頂点の並び。両端は、接点 */
function arcPoints(v: Point2D, uP: Point2D, uQ: Point2D, t: number, radius: number, theta: number): Point2D[] | null {
  const tangentP = { x: v.x + uP.x * t, y: v.y + uP.y * t };
  const tangentQ = { x: v.x + uQ.x * t, y: v.y + uQ.y * t };
  // 中心: 接点 P から、手前の線分に垂直に、次の線分の側へ、半径だけ離れた所
  let nx = -uP.y;
  let ny = uP.x;
  if (nx * uQ.x + ny * uQ.y < 0) {
    nx = -nx;
    ny = -ny;
  }
  const center = { x: tangentP.x + nx * radius, y: tangentP.y + ny * radius };
  if (!isFinitePoint(center) || !isFinitePoint(tangentP) || !isFinitePoint(tangentQ)) return null;
  const angleP = Math.atan2(tangentP.y - center.y, tangentP.x - center.x);
  const angleQ = Math.atan2(tangentQ.y - center.y, tangentQ.x - center.x);
  // P から Q へ向かう、符号つきの掃引(大きさは π − θ。π より小さいので、(−π, π] の中で1通りに決まる)
  const sweep = Math.atan2(Math.sin(angleQ - angleP), Math.cos(angleQ - angleP));
  const steps = Math.max(1, Math.ceil((Math.PI - theta) / MAX_ARC_STEP));
  const points: Point2D[] = [tangentP];
  for (let k = 1; k < steps; k++) {
    const angle = angleP + (sweep * k) / steps;
    points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
  points.push(tangentQ);
  // すべての点が、中心から半径だけ離れていること(座標の桁が大きく、丸め落ちた結果を断る)
  for (const point of points) {
    if (!(Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius) <= RADIUS_TOLERANCE * radius)) return null;
  }
  return points;
}

function polylineCorner(polyline: CadPolyline, clickA: Point2D, clickB: Point2D, mode: CornerMode): CornerResult {
  if (isZeroMode(mode)) return fail(CORNER_NOTHING_CHANGES_REASON);
  const chain = chainOf(polyline);
  const n = chain.vertices.length;
  const count = segmentCount(chain);
  if (count < 2) return fail("線分が2本ない折れ線は、角を処理できません");
  // 2頂点の閉じた折れ線(往復する2本)は、どの頂点で角を作るか決まらない
  if (chain.closed && count === 2) return fail(CORNER_NOT_ADJACENT_REASON);
  const segmentA = nearestSegmentIndex(chain, clickA);
  const segmentB = nearestSegmentIndex(chain, clickB);
  if (segmentA < 0 || segmentB < 0) return fail(CORNER_UNCOMPUTABLE_REASON);
  if (segmentA === segmentB) return fail(CORNER_SAME_SEGMENT_REASON);
  const follows = (x: number, y: number): boolean => y === x + 1 || (chain.closed && x === count - 1 && y === 0);
  let before: number;
  let after: number;
  if (follows(segmentA, segmentB)) {
    before = segmentA;
    after = segmentB;
  } else if (follows(segmentB, segmentA)) {
    before = segmentB;
    after = segmentA;
  } else {
    return fail(CORNER_NOT_ADJACENT_REASON);
  }
  // 線分 after は、頂点 after から始まる。2本の線分が共有する頂点が、角
  const j = after;
  const p = chain.vertices[(j - 1 + n) % n];
  const v = chain.vertices[j];
  const q = chain.vertices[(j + 1) % n];
  const lengthP = Math.hypot(p.x - v.x, p.y - v.y);
  const lengthQ = Math.hypot(q.x - v.x, q.y - v.y);
  if (!(lengthP > 0) || !(lengthQ > 0) || !Number.isFinite(lengthP) || !Number.isFinite(lengthQ)) return fail("長さが 0 の線分は、角を処理できません");
  const uP = { x: (p.x - v.x) / lengthP, y: (p.y - v.y) / lengthP };
  const uQ = { x: (q.x - v.x) / lengthQ, y: (q.y - v.y) / lengthQ };
  const angle = interiorAngle(uP, uQ);
  const { theta, sin } = angle;
  if (!(sin > PARALLEL_EPSILON)) return fail("2本の線分が一直線(または折り返し)なので、角がありません");

  const { d1, d2 } = tangentDistances(mode, angle);
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return fail(CORNER_UNCOMPUTABLE_REASON);
  // 距離1は、1つ目に選んだ線分の上、距離2は、2つ目に選んだ線分の上
  const distanceBefore = segmentA === before ? d1 : d2;
  const distanceAfter = segmentA === before ? d2 : d1;
  if (!fits(distanceBefore, lengthP)) return fail(tooLongReason(mode, distanceBefore, lengthP, "線分"));
  if (!fits(distanceAfter, lengthQ)) return fail(tooLongReason(mode, distanceAfter, lengthQ, "線分"));

  // 接点が、隣の頂点とほぼ同じ位置なら、その頂点を使う(長さ 0 の線分を作らない)
  const atP = distanceBefore >= lengthP * (1 - LENGTH_SLACK);
  const atQ = distanceAfter >= lengthQ * (1 - LENGTH_SLACK);
  let corner: Point2D[];
  if (mode.kind === "chamfer") {
    corner = [
      { x: v.x + uP.x * distanceBefore, y: v.y + uP.y * distanceBefore },
      { x: v.x + uQ.x * distanceAfter, y: v.y + uQ.y * distanceAfter },
    ];
  } else {
    const points = arcPoints(v, uP, uQ, d1, mode.radius, theta);
    if (points === null) return fail(CORNER_PRECISION_REASON);
    corner = points;
  }
  if (atP) corner = corner.slice(1);
  if (atQ) corner = corner.slice(0, -1);
  if (!corner.every(isFinitePoint)) return fail(CORNER_UNCOMPUTABLE_REASON);

  // 置き換えた所で、連続する頂点が同じ位置になる(座標の桁に比べて、半径・距離が小さすぎる)と、長さ 0 の線分ができるので、断る。
  // 元の折れ線が、もともと持っている重複した頂点は、調べない(対象外の場所)
  const local = [p, ...corner, q];
  for (let i = 0; i + 1 < local.length; i++) {
    if (local[i].x === local[i + 1].x && local[i].y === local[i + 1].y) return fail(CORNER_PRECISION_REASON);
  }
  const vertices = [...chain.vertices.slice(0, j), ...corner, ...chain.vertices.slice(j + 1)];
  if (vertices.length < (chain.closed ? 3 : 2)) return fail("結果の図形が成り立ちません(頂点が足りません)");
  return { ok: true, replaced: [{ ...polyline, vertices }], added: [] };
}

// ---- 入口 ----

/**
 * 2つの図形(と、それぞれをクリックした位置)の間の角を、丸める(fillet)・面取りする(chamfer)。
 * - 別々の2本の線: 交点を角にする。クリックした側の腕を残して、接点まで短く(または延ばし)する。半径(距離)が 0 なら、角を作るだけ。
 * - 同じ折れ線の、隣り合う2本の線分: その間の頂点を、円弧(点列)・斜めの線に置き換える。
 * 対象にできないものは、理由つきで ok: false。
 */
export function cornerEntities(first: CadEntity, firstClick: Point2D, second: CadEntity, secondClick: Point2D, mode: CornerMode): CornerResult {
  const invalid = validateCornerMode(mode);
  if (invalid !== null) return fail(invalid);
  if (!isFinitePoint(firstClick) || !isFinitePoint(secondClick)) return fail("クリックの位置が正しくありません");
  if (!FILLET_TYPES.has(first.type)) return fail(`${first.type} は、処理できません(線・折れ線が対象です)`);
  if (!FILLET_TYPES.has(second.type)) return fail(`${second.type} は、処理できません(線・折れ線が対象です)`);
  if (first.id === second.id) {
    if (first.type === "LINE") return fail(CORNER_SAME_LINE_REASON);
    return polylineCorner(first as CadPolyline, firstClick, secondClick, mode);
  }
  if (first.type === "LINE" && second.type === "LINE") return lineCorner(first, firstClick, second, secondClick, mode);
  return fail(CORNER_MIXED_REASON);
}
