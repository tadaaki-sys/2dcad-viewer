// グリップを動かしている間の仮表示(ゴム紐)(Phase 18)。図面のデータは変えない。画面にも依存しない。
import { entityPreviewShapes, PREVIEW_VERTEX_LIMIT } from "../commands/entityPreview";
import type { PreviewShape } from "../commands/registry";
import { IDENTITY_MATRIX } from "../geometry/transform";
import type { CadEntity, Point2D } from "../../types/cad";
import { applyGrip } from "./grips";

/**
 * 図形のグリップ(index)を、カーソルの位置へ動かした形の仮表示を作る関数。動かせない位置では空
 * (確定のときに、理由つきで断られる)。頂点が非常に多い折れ線は、カーソルを動かすたびの計算が重いので、仮表示を出さない。
 */
export function createGripPreview(entity: CadEntity, index: number): (cursor: Point2D) => readonly PreviewShape[] {
  const heavy = (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && entity.vertices.length > PREVIEW_VERTEX_LIMIT;
  if (heavy) return () => [];
  return (cursor) => {
    const edit = applyGrip(entity, index, cursor);
    return edit.ok ? entityPreviewShapes(edit.entity, IDENTITY_MATRIX) : [];
  };
}
