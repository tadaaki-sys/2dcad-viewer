import type { CadEntity, Point2D } from "../../types/cad";

/** Snap の候補を調べるときの、共通の入力 */
export type GeneratorContext = {
  /** カーソルの近く(許容距離以内に外接の矩形がある)の図形 */
  entities: readonly CadEntity[];
  visibleLayerNames: ReadonlySet<string>;
  worldPoint: Point2D;
  toleranceWorld: number;
  /** 垂線・接線の基準の点(作図中の直前の点など)。無ければ null */
  fromPoint: Point2D | null;
  /** 中心を調べる図形(円は、カーソルの近く。円弧・楕円は、外接の矩形がカーソルから離れていても中心が近いことがあるので、図面全体) */
  centerEntities: readonly CadEntity[];
  /** 延長を調べる図形(カーソルから acquire の距離以内に外接の矩形がある図形) */
  extensionEntities: readonly CadEntity[];
  /** 延長の対象にする、端点とカーソルの最大距離(ワールド単位) */
  extensionAcquireWorld: number;
};
