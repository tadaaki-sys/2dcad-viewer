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
  const reach = Math.hypot(viewportWidth, viewportHeight) * 2;
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  for (const guide of guides) {
    const origin = camera.worldToScreen(guide.origin);
    const radians = (guide.angleDeg * Math.PI) / 180;
    // 画面の Y 軸は下向きなので、角度の向きが逆になる
    const dx = Math.cos(radians) * reach;
    const dy = -Math.sin(radians) * reach;
    if (![origin.x, origin.y, dx, dy].every(Number.isFinite)) continue;
    ctx.beginPath();
    ctx.moveTo(guide.oneSided ? origin.x : origin.x - dx, guide.oneSided ? origin.y : origin.y - dy);
    ctx.lineTo(origin.x + dx, origin.y + dy);
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
