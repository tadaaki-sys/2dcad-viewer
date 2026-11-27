// グリップ(選択した図形のつかむ点)の描画と、当たり判定(Phase 18)。画面の大きさ(px)で決まる。
import type { Camera } from "../../core/view/Camera";
import type { GripKind } from "../../core/grip/grips";
import type { Point2D } from "../../types/cad";

export type GripMark = {
  /** 図形のIDと、図形の中の番号で決まる、一意の名前 */
  key: string;
  entityId: string;
  index: number;
  kind: GripKind;
  point: Point2D;
};

/** グリップの大きさ(1辺。画面のpx)と、クリックで指せる範囲(半径。画面のpx) */
const GRIP_SIZE_PX = 8;
export const GRIP_HIT_RADIUS_PX = 8;
/** 端のグリップと重なったとき、中点・四半円点より、端を優先するための、距離への上乗せ(画面のpx) */
const MID_GRIP_BIAS_PX = 3;

const COLD_COLOR = "#2f7bff";
const HOVER_COLOR = "#ffa31a";
const HOT_COLOR = "#ff3b30";

export function gripKeyOf(entityId: string, index: number): string {
  return `${entityId}#${index}`;
}

/** 画面の位置 screen に最も近いグリップ(当たり範囲の中)。無ければ null */
export function findGripAt(grips: readonly GripMark[], camera: Camera, screen: Point2D): GripMark | null {
  let best: GripMark | null = null;
  let bestScore = Infinity;
  for (const grip of grips) {
    const at = camera.worldToScreen(grip.point);
    const distance = Math.hypot(at.x - screen.x, at.y - screen.y);
    if (distance > GRIP_HIT_RADIUS_PX) continue;
    // 短い線分で、端と中点が重なるときに、端のグリップを選べるように、中点・四半円点は、少し遠いものとして扱う
    const score = distance + (grip.kind === "mid" || grip.kind === "quadrant" ? MID_GRIP_BIAS_PX : 0);
    if (score < bestScore) {
      best = grip;
      bestScore = score;
    }
  }
  return best;
}

/** グリップを描く。ホットなグリップは赤、カーソルが乗っているものは橙、ほかは青。中点・四半円点などは、中を抜いた四角 */
export function drawGrips(ctx: CanvasRenderingContext2D, camera: Camera, grips: readonly GripMark[], hoverKey: string | null, hot: GripMark | null): void {
  ctx.save();
  ctx.lineWidth = 1;
  const half = GRIP_SIZE_PX / 2;
  const draw = (grip: GripMark, color: string, filled: boolean): void => {
    const at = camera.worldToScreen(grip.point);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (filled) ctx.fillRect(at.x - half, at.y - half, GRIP_SIZE_PX, GRIP_SIZE_PX);
    else ctx.strokeRect(at.x - half + 0.5, at.y - half + 0.5, GRIP_SIZE_PX - 1, GRIP_SIZE_PX - 1);
  };
  for (const grip of grips) {
    if (hot !== null && grip.key === hot.key) continue;
    draw(grip, grip.key === hoverKey ? HOVER_COLOR : COLD_COLOR, grip.kind !== "mid" && grip.kind !== "quadrant");
  }
  if (hot !== null) draw(hot, HOT_COLOR, true);
  ctx.restore();
}
