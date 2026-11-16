// トラッキングの一時補助線、取得した点の目印、説明(角度など)の描画。描画だけを行い、計算はしない(計算は core/tracking)。
import type { Camera } from "../../core/view/Camera";
import type { TrackingGuide } from "../../core/tracking/trackingGeometry";
import type { Point2D } from "../../types/cad";

const GUIDE_COLOR = "rgba(0, 229, 255, 0.6)";
const ACQUIRED_COLOR = "#00e5ff";
const ACQUIRED_HALF_SIZE_PX = 5;
const LABEL_FONT = "12px sans-serif";

/** 補助線に添える説明(角度など)。point は、揃えた点 */
export type TrackingLabel = { point: Point2D; text: string };

/**
 * 補助線(起点から、向き(dirX, dirY。長さ1。画面の座標)に延びる直線または半直線)の、画面(0〜width、0〜height)の中にある区間。
 * 画面にかからないときは null。起点が画面から非常に遠くても、画面にかかる区間を、正しく求める。
 */
export function clipGuideToViewport(
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  oneSided: boolean,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (![originX, originY, dirX, dirY, width, height].every(Number.isFinite)) return null;
  let t0 = oneSided ? 0 : -Infinity;
  let t1 = Infinity;
  const margin = 1; // 画面の端で、線が切れて見えないように、少し外まで
  for (const [origin, dir, min, max] of [
    [originX, dirX, -margin, width + margin],
    [originY, dirY, -margin, height + margin],
  ] as const) {
    if (Math.abs(dir) < 1e-12) {
      if (origin < min || origin > max) return null; // この軸に平行で、画面の外
      continue;
    }
    const a = (min - origin) / dir;
    const b = (max - origin) / dir;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (!(t0 <= t1) || !Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return { x0: originX + dirX * t0, y0: originY + dirY * t0, x1: originX + dirX * t1, y1: originY + dirY * t1 };
}

/** 補助線(破線)、取得した点の目印(＋)、説明を描く。補助線は、画面の端まで延ばす */
export function drawTracking(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  guides: readonly TrackingGuide[],
  acquired: readonly Point2D[],
  label: TrackingLabel | null,
): void {
  if (guides.length === 0 && acquired.length === 0) return;
  ctx.save();
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  for (const guide of guides) {
    const origin = camera.worldToScreen(guide.origin);
    const radians = (guide.angleDeg * Math.PI) / 180;
    // 画面の Y 軸は下向きなので、角度の向きが逆になる
    const clipped = clipGuideToViewport(origin.x, origin.y, Math.cos(radians), -Math.sin(radians), guide.oneSided, viewportWidth, viewportHeight);
    if (clipped === null) continue;
    ctx.beginPath();
    ctx.moveTo(clipped.x0, clipped.y0);
    ctx.lineTo(clipped.x1, clipped.y1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = ACQUIRED_COLOR;
  ctx.lineWidth = 1.5;
  for (const point of acquired) {
    const screen = camera.worldToScreen(point);
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;
    ctx.beginPath();
    ctx.moveTo(screen.x - ACQUIRED_HALF_SIZE_PX, screen.y);
    ctx.lineTo(screen.x + ACQUIRED_HALF_SIZE_PX, screen.y);
    ctx.moveTo(screen.x, screen.y - ACQUIRED_HALF_SIZE_PX);
    ctx.lineTo(screen.x, screen.y + ACQUIRED_HALF_SIZE_PX);
    ctx.stroke();
  }
  if (label !== null) {
    const screen = camera.worldToScreen(label.point);
    ctx.fillStyle = ACQUIRED_COLOR;
    ctx.font = LABEL_FONT;
    ctx.fillText(label.text, screen.x + 10, screen.y + 18);
  }
  ctx.restore();
}
