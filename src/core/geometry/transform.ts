// 図形の変換(移動・回転)の計算。画面にも図面データの保存にも依存しない純粋な処理。
// 変換は、形を保つもの(相似変換: 移動・回転・一様な拡大縮小・鏡像)を扱う。非一様な拡大縮小・せん断は、扱わない。
import type { Affine2D, CadEntity, Point2D } from "../../types/cad";
import { normalizeAngle } from "./construct";
import { ellipseFromConjugateDiameters } from "./ellipseTransform";

export const IDENTITY_MATRIX: Affine2D = [1, 0, 0, 1, 0, 0];

/** 剛体かの判定の許容(行列の各成分の誤差) */
const RIGID_EPSILON = 1e-9;
/**
 * 移動・回転だけの経路(寸法に触らない)に入る、倍率の許容。回転の行列の丸め誤差(1e-16 程度)は許し、
 * 利用者が指定した倍率(1.0000000001 など)は、拡大縮小の経路で、位置と大きさの両方に掛ける。
 */
const RIGID_SCALE_TOLERANCE = 1e-12;
/** 回転角が 90° の倍数とみなす許容(ラジアン) */
const QUARTER_TURN_EPSILON = 1e-12;
/** 90° の倍数の判定を行う角度の上限(ラジアン)。これ以上では、浮動小数点の間隔(1e3 で約1e-13)が許容に近づく */
const EXACT_ANGLE_LIMIT = 1e3;

/** 平行移動(dx, dy) */
export function translationMatrix(dx: number, dy: number): Affine2D {
  return [1, 0, 0, 1, dx, dy];
}

/** 角度(ラジアン)の cos と sin。90° の倍数は、正確な値(0・±1)を返す(cos(90°) が 6e-17 になって、座標に誤差が入るのを防ぐ) */
export function exactCosSin(angle: number): { cos: number; sin: number } {
  const quarter = Math.PI / 2;
  const turns = Math.round(angle / quarter);
  // 角度が大きいと、浮動小数点の間隔が許容より広くなり、「90°の倍数」の判定が偶然に成立してしまうので、小さい角度だけに限る
  if (Math.abs(angle) < EXACT_ANGLE_LIMIT && Number.isFinite(turns) && Math.abs(angle - turns * quarter) < QUARTER_TURN_EPSILON) {
    const exact = [
      { cos: 1, sin: 0 },
      { cos: 0, sin: 1 },
      { cos: -1, sin: 0 },
      { cos: 0, sin: -1 },
    ];
    return exact[((turns % 4) + 4) % 4];
  }
  return { cos: Math.cos(angle), sin: Math.sin(angle) };
}

/** center を中心に、angle(ラジアン、反時計回りが正)だけ回転 */
export function rotationMatrix(center: Point2D, angle: number): Affine2D {
  const { cos, sin } = exactCosSin(angle);
  return [cos, sin, -sin, cos, center.x - cos * center.x + sin * center.y, center.y - sin * center.x - cos * center.y];
}

/** 変換を続けて行う: まず first、次に second */
export function composeAffine(first: Affine2D, second: Affine2D): Affine2D {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ];
}

export function applyAffine(matrix: Affine2D, point: Point2D): Point2D {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

/** 長さと形を変えない変換(移動・回転だけ。向きも反転しない)か */
export function isRigid(matrix: Affine2D): boolean {
  const [a, b, c, d] = matrix;
  return (
    matrix.every(Number.isFinite) &&
    Math.abs(a - d) < RIGID_EPSILON &&
    Math.abs(b + c) < RIGID_EPSILON &&
    Math.abs(a * a + b * b - 1) < RIGID_EPSILON
  );
}

/** 変換が、何も動かさないか(単位行列) */
export function isIdentity(matrix: Affine2D): boolean {
  return matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1 && matrix[4] === 0 && matrix[5] === 0;
}

/** 剛体の変換の、回転角(ラジアン) */
export function rotationAngleOf(matrix: Affine2D): number {
  return Math.atan2(matrix[1], matrix[0]);
}

/** 倍率 factor の拡大縮小(base が動かない点) */
export function scaleMatrix(base: Point2D, factor: number): Affine2D {
  return [factor, 0, 0, factor, base.x - factor * base.x, base.y - factor * base.y];
}

/**
 * 点 p と q を通る直線を軸にした鏡像の行列。p と q が同じ点(軸が決まらない)ときは null。
 * 軸が水平・垂直・45度のときは、成分がぴったりの値(±1・0)になる。
 */
export function reflectionMatrix(p: Point2D, q: Point2D): Affine2D | null {
  const rawX = q.x - p.x;
  const rawY = q.y - p.y;
  const largest = Math.max(Math.abs(rawX), Math.abs(rawY));
  if (!(largest > 0) || !Number.isFinite(largest)) return null;
  // 大きい方の成分で割ってから計算する(二乗の桁あふれ・桁落ちを避ける)。軸が水平・垂直・45度なら、ux・uy は 0・±1 で、ぴったりの値になる
  const dx = rawX / largest;
  const dy = rawY / largest;
  const lengthSquared = dx * dx + dy * dy;
  // 軸の角度を φ として、線形部分は [[cos2φ, sin2φ], [sin2φ, -cos2φ]]。「|| 0」は、-0 を 0 にそろえる
  const cos2 = (dx * dx - dy * dy) / lengthSquared || 0;
  const sin2 = (2 * dx * dy) / lengthSquared || 0;
  const a = cos2;
  const b = sin2;
  const c = sin2;
  const d = -cos2 || 0;
  return [a, b, c, d, p.x - (a * p.x + c * p.y) || 0, p.y - (b * p.x + d * p.y) || 0];
}

/** 形を保つ変換(移動・回転・一様な拡大縮小・鏡像)か。非一様な拡大縮小・せん断・つぶれる変換は、false */
export function isSimilarity(matrix: Affine2D): boolean {
  if (!matrix.every(Number.isFinite)) return false;
  const [a, b, c, d] = matrix;
  const scale = Math.hypot(a, b);
  if (!(scale > 0)) return false;
  const tolerance = RIGID_EPSILON * scale;
  const proper = Math.abs(a - d) <= tolerance && Math.abs(b + c) <= tolerance;
  const reflecting = Math.abs(a + d) <= tolerance && Math.abs(b - c) <= tolerance;
  return proper || reflecting;
}

/** 向きを反転する(鏡像を含む)変換か */
export function isReflecting(matrix: Affine2D): boolean {
  return matrix[0] * matrix[3] - matrix[1] * matrix[2] < 0;
}

/** 相似変換の倍率(長さが何倍になるか) */
export function scaleFactorOf(matrix: Affine2D): number {
  return Math.hypot(matrix[0], matrix[1]);
}

/**
 * 拡大縮小・鏡像を含む相似変換で、図形を動かす(transformEntityGeometry から呼ぶ)。
 * - 円・円弧・楕円の半径、文字の高さは、倍率を掛ける。線の太さ・破線の間隔は、変えない。
 * - 円弧: 鏡像では向きが逆になるので、始点と終点を入れ替える(反時計回りの円弧のまま)。
 * - 楕円: 鏡像は、共役な半径から、標準形に直す(ellipseTransform)。
 * - 文字: 鏡像でも、文字そのものは反転させない(読める形を保つ)。挿入点だけを動かし、向きは変えない。
 */
function transformSimilar(entity: CadEntity, matrix: Affine2D, move: (p: Point2D) => Point2D): CadEntity {
  const [a, b, c, d] = matrix;
  const factor = scaleFactorOf(matrix);
  const reflecting = isReflecting(matrix);
  const scaled = (value: number): number => {
    const result = value * factor;
    if (Number.isFinite(value) && !Number.isFinite(result)) throw new Error("変換後の大きさが大きすぎて、扱えません");
    return result;
  };
  // 回転を伴わない変換(倍率だけ)のときは、角度の値には、触らない
  // (a < 0 の b = c = 0 は、180度の回転を含むので、回転なしではない)
  const noRotation = !reflecting && b === 0 && c === 0 && a > 0;
  const angle = reflecting || noRotation ? 0 : rotationAngleOf(matrix);
  const turn = (value: number): number => (noRotation ? value : normalizeAngle(value + angle));
  // 向きの角度を、変換した向きの角度にする(鏡像用。線形部分で、方向ベクトルを変換する)
  const mapDirection = (value: number): number => normalizeAngle(Math.atan2(b * Math.cos(value) + d * Math.sin(value), a * Math.cos(value) + c * Math.sin(value)));

  switch (entity.type) {
    case "LINE":
      return { ...entity, start: move(entity.start), end: move(entity.end) };
    case "LWPOLYLINE":
    case "POLYLINE":
      return { ...entity, vertices: entity.vertices.map((vertex) => ({ ...vertex, ...move(vertex) })) };
    case "CIRCLE":
      return { ...entity, center: move(entity.center), radius: scaled(entity.radius) };
    case "ARC":
      return reflecting
        ? { ...entity, center: move(entity.center), radius: scaled(entity.radius), startAngle: mapDirection(entity.endAngle), endAngle: mapDirection(entity.startAngle) }
        : { ...entity, center: move(entity.center), radius: scaled(entity.radius), startAngle: turn(entity.startAngle), endAngle: turn(entity.endAngle) };
    case "ELLIPSE": {
      if (!reflecting) {
        return { ...entity, center: move(entity.center), majorRadius: scaled(entity.majorRadius), minorRadius: scaled(entity.minorRadius), rotation: turn(entity.rotation) };
      }
      const cos = Math.cos(entity.rotation);
      const sin = Math.sin(entity.rotation);
      // 長軸・短軸の向きの半径ベクトルを、線形部分で変換したものが、共役な半径
      const u = { x: entity.majorRadius * (a * cos + c * sin), y: entity.majorRadius * (b * cos + d * sin) };
      const v = { x: entity.minorRadius * (-a * sin + c * cos), y: entity.minorRadius * (-b * sin + d * cos) };
      const shape = ellipseFromConjugateDiameters(u, v, entity.startParam, entity.endParam);
      if (shape === null) throw new Error("楕円を変換できません");
      return { ...entity, center: move(entity.center), majorRadius: shape.majorRadius, minorRadius: shape.minorRadius, rotation: normalizeAngle(shape.rotation), startParam: shape.startParam, endParam: shape.endParam };
    }
    case "SPLINE":
      return { ...entity, points: entity.points.map(move) };
    case "POINT":
      return { ...entity, position: move(entity.position) };
    case "TEXT":
      // 文字は反転させない。鏡像のときは、向きを変えない
      // 枠の幅(MTEXT の折り返し)も、拡大縮小に合わせて変える
      return {
        ...entity,
        position: move(entity.position),
        height: scaled(entity.height),
        ...(entity.boxWidth !== undefined ? { boxWidth: scaled(entity.boxWidth) } : {}),
        rotation: reflecting ? entity.rotation : turn(entity.rotation),
      };
  }
}

/**
 * 図形の形を、相似変換(移動・回転・一様な拡大縮小・鏡像)で動かした、新しい図形を返す(元の図形は変えない)。
 * ID・レイヤー・色・線種など、形以外は、そのまま。非一様な拡大縮小・せん断は、エラー(ここでは扱わない)。
 * 純粋な平行移動(回転なし)のときは、角度の値には、触らない(角度の値が、わずかでも変わらないように)。
 */
export function transformEntityGeometry(entity: CadEntity, matrix: Affine2D): CadEntity {
  if (!isSimilarity(matrix)) throw new Error("移動・回転・拡大縮小・鏡像以外の変換は、扱えません");
  const move = (p: Point2D): Point2D => {
    const moved = applyAffine(matrix, p);
    // 有限な座標が、変換で有限でなくなる(桁あふれ)ときは、図形を壊さないよう、変換そのものを拒否する。
    // もともと有限でない座標(壊れたデータ)は、これまでどおり、そのまま扱う。
    if (Number.isFinite(p.x) && Number.isFinite(p.y) && !(Number.isFinite(moved.x) && Number.isFinite(moved.y))) {
      throw new Error("変換後の座標が大きすぎて、扱えません");
    }
    return moved;
  };
  // 拡大縮小・鏡像を含む変換は、別の経路で扱う(移動・回転だけの変換の計算は、これまでと完全に同じ)
  if (!isRigid(matrix) || Math.abs(scaleFactorOf(matrix) - 1) > RIGID_SCALE_TOLERANCE) return transformSimilar(entity, matrix, move);
  const rotates = !(matrix[0] === 1 && matrix[1] === 0);
  const angle = rotates ? rotationAngleOf(matrix) : 0;
  const turn = (value: number): number => (rotates ? normalizeAngle(value + angle) : value);

  switch (entity.type) {
    case "LINE":
      return { ...entity, start: move(entity.start), end: move(entity.end) };
    case "LWPOLYLINE":
    case "POLYLINE":
      // bulge などの、頂点が持つほかの値は、そのまま残す
      return { ...entity, vertices: entity.vertices.map((vertex) => ({ ...vertex, ...move(vertex) })) };
    case "CIRCLE":
      return { ...entity, center: move(entity.center) };
    case "ARC":
      return { ...entity, center: move(entity.center), startAngle: turn(entity.startAngle), endAngle: turn(entity.endAngle) };
    case "ELLIPSE":
      // startParam・endParam は、長軸からの角度なので、回転しても変わらない
      return { ...entity, center: move(entity.center), rotation: turn(entity.rotation) };
    case "SPLINE":
      return { ...entity, points: entity.points.map(move) };
    case "POINT":
      return { ...entity, position: move(entity.position) };
    case "TEXT":
      return { ...entity, position: move(entity.position), rotation: turn(entity.rotation) };
  }
}
