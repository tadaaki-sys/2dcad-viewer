import type { Point2D } from "../types/cad";
import type { Matrix2D } from "./matrix2d";

const SIMILARITY_TOLERANCE = 1e-9;

/** 行列の線形部分(平行移動を除く)のX基底ベクトルとY基底ベクトル */
export function linearBasis(m: Matrix2D): { lx: Point2D; ly: Point2D } {
  return { lx: { x: m.a, y: m.b }, ly: { x: m.c, y: m.d } };
}

/** 回転・一様拡大縮小・鏡像だけの変換か(円が円のままになる変換か)。軸の長さが等しく直交していればtrue */
export function isSimilarityTransform(m: Matrix2D): boolean {
  const { lx, ly } = linearBasis(m);
  const lengthX = Math.hypot(lx.x, lx.y);
  const lengthY = Math.hypot(ly.x, ly.y);
  const scale = Math.max(lengthX, lengthY);
  if (!(scale > 0)) return false;
  const dot = lx.x * ly.x + lx.y * ly.y;
  return Math.abs(lengthX - lengthY) <= SIMILARITY_TOLERANCE * scale && Math.abs(dot) <= SIMILARITY_TOLERANCE * scale * scale;
}

/** 行列が向きを反転する(鏡像を含む)変換か */
export function isReflection(m: Matrix2D): boolean {
  return m.a * m.d - m.b * m.c < 0;
}

export type EllipseParams = {
  majorRadius: number;
  minorRadius: number;
  /** メジャー軸の向き(ラジアン、+X軸からCCW) */
  rotation: number;
  /** 楕円パラメータ角の範囲(CCW)。全周は差が2π */
  startParam: number;
  endParam: number;
};

/**
 * 点P(t) = 中心 + u*cos(t) + v*sin(t) (uとvは共役半径ベクトル)で表される楕円(弧)を、
 * 直交するメジャー軸・マイナー軸を持つ標準形へ変換する。
 *
 * 円や楕円に任意のアフィン変換(非一様拡大・せん断・鏡像を含む)をかけると、
 * 変換後の基底ベクトルがちょうど共役半径になるので、この関数で厳密な楕円に戻せる。
 * 鏡像で向きが反転した場合は、パラメータ範囲を反転して同じ弧を表す。
 * 退化している(長さ0・非有限)場合はnull。
 */
export function ellipseFromConjugateDiameters(
  u: Point2D,
  v: Point2D,
  startParam: number,
  endParam: number,
): EllipseParams | null {
  const uu = u.x * u.x + u.y * u.y;
  const vv = v.x * v.x + v.y * v.y;
  const uv = u.x * v.x + u.y * v.y;
  if (!Number.isFinite(uu + vv + uv)) return null;

  // |P(t)|^2が最大になるt0がメジャー軸の方向
  const t0 = 0.5 * Math.atan2(2 * uv, uu - vv);
  const cos = Math.cos(t0);
  const sin = Math.sin(t0);
  const major = { x: u.x * cos + v.x * sin, y: u.y * cos + v.y * sin };
  const minor = { x: -u.x * sin + v.x * cos, y: -u.y * sin + v.y * cos };

  const majorRadius = Math.hypot(major.x, major.y);
  const minorRadius = Math.hypot(minor.x, minor.y);
  if (!(majorRadius > 0)) return null;

  const rotation = Math.atan2(major.y, major.x);
  const isRightHanded = major.x * minor.y - major.y * minor.x >= 0;
  // 左手系(鏡像)のときは、s = -(t - t0) を新しいパラメータにすると右手系の標準形になる
  const range: [number, number] = isRightHanded ? [startParam - t0, endParam - t0] : [t0 - endParam, t0 - startParam];

  return { majorRadius, minorRadius, rotation, startParam: range[0], endParam: range[1] };
}
