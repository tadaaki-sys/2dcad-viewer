// グリップの当たり判定(Phase 18)
import { describe, expect, it } from "vitest";
import type { Camera } from "../../core/view/Camera";
import { findGripAt, gripKeyOf, GRIP_HIT_RADIUS_PX } from "./gripRender";
import type { GripMark } from "./gripRender";

// 図面の座標を、そのまま画面の座標として扱う(拡大率 1)
const camera = { worldToScreen: (p: { x: number; y: number }) => p } as unknown as Camera;
const mark = (index: number, kind: GripMark["kind"], x: number, y: number): GripMark => ({ key: gripKeyOf("e", index), entityId: "e", index, kind, point: { x, y } });

describe("findGripAt", () => {
  it("finds the nearest grip within the hit radius, and nothing outside it", () => {
    const grips = [mark(0, "end", 0, 0), mark(1, "end", 100, 0)];
    expect(findGripAt(grips, camera, { x: 3, y: 0 })?.index).toBe(0);
    expect(findGripAt(grips, camera, { x: 97, y: 2 })?.index).toBe(1);
    expect(findGripAt(grips, camera, { x: 50, y: 0 })).toBeNull();
    expect(findGripAt(grips, camera, { x: GRIP_HIT_RADIUS_PX + 1, y: 0 })).toBeNull();
    expect(findGripAt([], camera, { x: 0, y: 0 })).toBeNull();
  });

  it("when an end grip and the middle grip overlap (a very short segment), the end wins; a middle grip still wins when it is clearly closer", () => {
    const grips = [mark(0, "end", 0, 0), mark(1, "end", 4, 0), mark(2, "mid", 2, 0)];
    // 中点の真上: 中点が最も近いが、端の方を優先する(端までは 2px)
    expect(findGripAt(grips, camera, { x: 2, y: 0 })?.index).not.toBe(2);
    // 中点のすぐそば(端までは遠い)なら、中点
    const far = [mark(0, "end", 0, 0), mark(1, "end", 40, 0), mark(2, "mid", 20, 0)];
    expect(findGripAt(far, camera, { x: 21, y: 0 })?.index).toBe(2);
    // 重なった端が、同じ距離なら、先のものが選ばれる(順番に依らず、中点ではない)
    expect(findGripAt([mark(2, "mid", 0, 0), mark(0, "end", 0, 0)], camera, { x: 0, y: 0 })?.index).toBe(0);
  });
});
