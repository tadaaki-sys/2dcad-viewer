// Snap の目印(種類ごとの形と名前)と、格子点の表示。描画だけを行い、Snap の計算はしない(計算は core/snap)。
import type { Camera } from "../../core/view/Camera";
import { SNAP_TYPE_LABELS } from "../../core/snap/snapTypes";
import type { SnapType } from "../../core/snap/snapTypes";
import type { Point2D } from "../../types/cad";

export type SnapMarker = { point: Point2D; type: SnapType };

const SNAP_MARKER_COLOR = "#00e5ff";
const HALF = 5; // 目印の大きさ(半分。px)
const LABEL_FONT = "12px sans-serif";
const GRID_COLOR = "#3a3a3a";
/** 画面上の格子の間隔がこれ(px)より小さいときは、格子を表示しない(見えない・重い) */
export const MIN_GRID_SCREEN_SPACING_PX = 8;

/** 種類ごとの形(AutoCAD に準ずる): 端点=四角、中点=三角、交点=×、中心=円、四半円点=ひし形、垂線=直角、接線=円と接線、近接=砂時計、延長=点線、グリッド=十字 */
function traceShape(ctx: CanvasRenderingContext2D, x: number, y: number, type: SnapType): void {
  ctx.beginPath();
  switch (type) {
    case "endpoint":
      ctx.rect(x - HALF, y - HALF, HALF * 2, HALF * 2);
      break;
    case "midpoint":
      ctx.moveTo(x, y - HALF);
      ctx.lineTo(x + HALF, y + HALF);
      ctx.lineTo(x - HALF, y + HALF);
      ctx.closePath();
      break;
    case "intersection":
      ctx.moveTo(x - HALF, y - HALF);
      ctx.lineTo(x + HALF, y + HALF);
      ctx.moveTo(x + HALF, y - HALF);
      ctx.lineTo(x - HALF, y + HALF);
      break;
    case "center":
      ctx.arc(x, y, HALF, 0, Math.PI * 2);
      break;
    case "quadrant":
      ctx.moveTo(x, y - HALF - 1);
      ctx.lineTo(x + HALF + 1, y);
      ctx.lineTo(x, y + HALF + 1);
      ctx.lineTo(x - HALF - 1, y);
      ctx.closePath();
      break;
    case "perpendicular":
      // 直角(L字)と、角の小さな四角
      ctx.moveTo(x - HALF, y - HALF);
      ctx.lineTo(x - HALF, y + HALF);
      ctx.lineTo(x + HALF, y + HALF);
      ctx.moveTo(x - HALF, y + 1);
      ctx.lineTo(x - 1, y + 1);
      ctx.lineTo(x - 1, y + HALF);
      break;
    case "tangent":
      ctx.arc(x, y, HALF - 1, 0, Math.PI * 2);
      ctx.moveTo(x - HALF - 2, y - HALF - 1);
      ctx.lineTo(x + HALF + 2, y - HALF - 1);
      break;
    case "nearest":
      // 砂時計(2つの三角形)
      ctx.moveTo(x - HALF, y - HALF);
      ctx.lineTo(x + HALF, y - HALF);
      ctx.lineTo(x - HALF, y + HALF);
      ctx.lineTo(x + HALF, y + HALF);
      ctx.closePath();
      break;
    case "extension":
      // 点線の十字
      ctx.moveTo(x - HALF - 1, y);
      ctx.lineTo(x + HALF + 1, y);
      ctx.moveTo(x, y - HALF - 1);
      ctx.lineTo(x, y + HALF + 1);
      break;
    case "grid":
      ctx.moveTo(x - HALF, y);
      ctx.lineTo(x + HALF, y);
      ctx.moveTo(x, y - HALF);
      ctx.lineTo(x, y + HALF);
      break;
  }
}

export function drawSnapMarker(ctx: CanvasRenderingContext2D, camera: Camera, marker: SnapMarker): void {
  const screen = camera.worldToScreen(marker.point);
  ctx.save();
  ctx.strokeStyle = SNAP_MARKER_COLOR;
  ctx.fillStyle = SNAP_MARKER_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash(marker.type === "extension" ? [3, 2] : []);
  traceShape(ctx, screen.x, screen.y, marker.type);
  ctx.stroke();
  // 種類の名前(目印の右上)
  ctx.setLineDash([]);
  ctx.font = LABEL_FONT;
  ctx.fillText(SNAP_TYPE_LABELS[marker.type], screen.x + HALF + 6, screen.y - HALF - 4);
  ctx.restore();
}

/** 格子点を、小さな点で描く(図形より下)。画面上の間隔が狭いときは描かない */
export function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, width: number, height: number, spacing: number): void {
  const k = camera.scale;
  const screenSpacing = spacing * k;
  if (!(spacing > 0) || !Number.isFinite(screenSpacing) || screenSpacing < MIN_GRID_SCREEN_SPACING_PX) return;
  const a = camera.screenToWorld({ x: 0, y: 0 });
  const b = camera.screenToWorld({ x: width, y: height });
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const firstI = Math.ceil(minX / spacing);
  const lastI = Math.floor(maxX / spacing);
  const firstJ = Math.ceil(minY / spacing);
  const lastJ = Math.floor(maxY / spacing);
  // 点の数の上限(画面の大きさを、最小の間隔で割った数)。それを超える見込みなら描かない
  if ((lastI - firstI + 1) * (lastJ - firstJ + 1) > (width / MIN_GRID_SCREEN_SPACING_PX + 2) * (height / MIN_GRID_SCREEN_SPACING_PX + 2)) return;
  ctx.save();
  ctx.fillStyle = GRID_COLOR;
  for (let i = firstI; i <= lastI; i++) {
    for (let j = firstJ; j <= lastJ; j++) {
      const screen = camera.worldToScreen({ x: i * spacing, y: j * spacing });
      ctx.fillRect(Math.round(screen.x) - 1, Math.round(screen.y) - 1, 2, 2);
    }
  }
  ctx.restore();
}
