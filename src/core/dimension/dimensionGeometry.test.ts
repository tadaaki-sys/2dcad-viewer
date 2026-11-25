// 寸法の形・整形・選択範囲・変換(Phase 15)
import { describe, expect, it } from "vitest";
import type { CadDimension, CadDimensionValues, CadEntity, Point2D } from "../../types/cad";
import { distanceFromPointToDimension, getEntityPoints, getEntitySegments } from "../geometry/entityGeometry";
import { rotationMatrix, reflectionMatrix, scaleMatrix, transformEntityGeometry, translationMatrix } from "../geometry/transform";
import { stretchEntityGeometry } from "../geometry/stretch";
import { computeAllEntityBounds } from "../spatial/entityBounds";
import { findEntitiesNearPoint, isEntityFullyInsideBox, isEntityTouchingBox } from "../selection/Selection";
import { formatDimensionAngle, formatDimensionDiameter, formatDimensionLength, formatDimensionRadius } from "./dimensionFormat";
import { dimensionTextEntity, layoutDimension, readableTextAngle } from "./dimensionGeometry";

const VALUES: CadDimensionValues = { textHeight: 100, arrowSize: 100, decimals: 0, angleDecimals: 1, unit: "mm", showUnit: false, extensionOffset: 50 };

const dimension = (patch: Partial<CadDimension> & Pick<CadDimension, "kind" | "p1" | "p2" | "position">): CadDimension => ({
  id: "d1",
  type: "DIMENSION",
  layer: "0",
  color: "#ffffff",
  values: VALUES,
  ...patch,
});

const horizontal = (p1: Point2D, p2: Point2D, position: Point2D, values: CadDimensionValues = VALUES): CadDimension => dimension({ kind: "linear", p1, p2, position, rotation: 0, values });
const near = (a: number, b: number, digits = 9): void => expect(a).toBeCloseTo(b, digits);
const layoutOf = (d: CadDimension) => {
  const layout = layoutDimension(d);
  if (layout === null) throw new Error("形が計算できません");
  return layout;
};

describe("number formatting", () => {
  it("converts to the unit, rounds to the decimals and appends the unit only when asked", () => {
    expect(formatDimensionLength(1234.5, { decimals: 0, unit: "mm", showUnit: false })).toBe("1235");
    expect(formatDimensionLength(1234.5, { decimals: 2, unit: "mm", showUnit: false })).toBe("1234.50");
    expect(formatDimensionLength(1234.5, { decimals: 1, unit: "cm", showUnit: true })).toBe("123.5 cm");
    expect(formatDimensionLength(1500, { decimals: 3, unit: "m", showUnit: true })).toBe("1.500 m");
    expect(formatDimensionRadius(25, { decimals: 0, unit: "mm", showUnit: false })).toBe("R25");
    expect(formatDimensionDiameter(50, { decimals: 1, unit: "mm", showUnit: true })).toBe("Ø50.0 mm");
    expect(formatDimensionAngle(Math.PI / 4, { angleDecimals: 1 })).toBe("45.0°");
    expect(formatDimensionAngle(Math.PI, { angleDecimals: 0 })).toBe("180°");
  });

  it("never prints a negative zero, and keeps huge values readable", () => {
    expect(formatDimensionLength(-0.0001, { decimals: 2, unit: "mm", showUnit: false })).toBe("0.00");
    expect(formatDimensionLength(-0, { decimals: 0, unit: "mm", showUnit: false })).toBe("0");
    expect(formatDimensionLength(1e25, { decimals: 2, unit: "mm", showUnit: false })).toBe("1.00e+25");
    expect(formatDimensionLength(Number.NaN, { decimals: 2, unit: "mm", showUnit: false })).toBe("?");
    // 桁は 0〜8 に収める
    expect(formatDimensionLength(1, { decimals: 99, unit: "mm", showUnit: false })).toBe("1.00000000");
    expect(formatDimensionLength(1.5, { decimals: -3, unit: "mm", showUnit: false })).toBe("2");
  });
});

describe("readable text angle", () => {
  it("keeps the text readable from the bottom or the right (-90 deg < angle <= 90 deg)", () => {
    near(readableTextAngle(0), 0);
    near(readableTextAngle(Math.PI / 2), Math.PI / 2);
    near(readableTextAngle(-Math.PI / 2), Math.PI / 2);
    near(readableTextAngle(Math.PI), 0);
    near(readableTextAngle((3 * Math.PI) / 4), -Math.PI / 4);
    near(readableTextAngle((-3 * Math.PI) / 4), Math.PI / 4);
    near(readableTextAngle(5 * Math.PI), 0);
  });
});

describe("linear dimensions", () => {
  it("horizontal: the measured value is the horizontal distance; the dimension line passes through the position", () => {
    const d = horizontal({ x: 0, y: 0 }, { x: 1000, y: 300 }, { x: 500, y: 800 });
    const layout = layoutOf(d);
    near(layout.value, 1000);
    expect(layout.text.text).toBe("1000");
    // 寸法線: y = 800 の水平線
    expect(layout.segments.at(-1)).toEqual([
      { x: 0, y: 800 },
      { x: 1000, y: 800 },
    ]);
    // 寸法補助線: 起点から 50 離れて始まり、寸法線の先 50(矢印の半分)まで出る
    expect(layout.segments[0]).toEqual([
      { x: 0, y: 50 },
      { x: 0, y: 850 },
    ]);
    expect(layout.segments[1]).toEqual([
      { x: 1000, y: 350 },
      { x: 1000, y: 850 },
    ]);
    expect(layout.arrows).toHaveLength(2);
    // 矢印の先は寸法線の両端、根元は内側へ矢印の長さ分
    expect(layout.arrows[0][0]).toEqual({ x: 0, y: 800 });
    expect(layout.arrows[1][0]).toEqual({ x: 1000, y: 800 });
    near(layout.arrows[0][1].x, 100);
    near(layout.arrows[0][1].y, 800 + 100 / 6);
    near(layout.arrows[0][2].y, 800 - 100 / 6);
  });

  it("vertical: the measured value is the vertical distance", () => {
    const d = dimension({ kind: "linear", p1: { x: 0, y: 0 }, p2: { x: 400, y: 1500 }, position: { x: -300, y: 700 }, rotation: Math.PI / 2 });
    const layout = layoutOf(d);
    near(layout.value, 1500);
    expect(layout.text.text).toBe("1500");
    expect(layout.segments.at(-1)).toEqual([
      { x: -300, y: 0 },
      { x: -300, y: 1500 },
    ]);
    // 縦の寸法の文字は、下から読める向き(90度)
    near(layout.text.rotation, Math.PI / 2);
  });

  it("aligned: measures along p1-p2 and rotates the text with the line", () => {
    const d = dimension({ kind: "aligned", p1: { x: 0, y: 0 }, p2: { x: 300, y: 400 }, position: { x: 100, y: 400 } });
    const layout = layoutOf(d);
    near(layout.value, 500);
    near(layout.text.rotation, Math.atan2(400, 300));
  });

  it("a dimension line drawn right-to-left keeps readable text and the same value", () => {
    const d = horizontal({ x: 1000, y: 0 }, { x: 0, y: 0 }, { x: 500, y: 300 });
    const layout = layoutOf(d);
    near(layout.value, 1000);
    near(layout.text.rotation, 0);
    // 矢印は、向きによらず、寸法線の内側を向く(根元が、先より内側)。右端(p1)の矢印の根元は、左へ 100
    expect(layout.arrows[0][0]).toEqual({ x: 1000, y: 300 });
    near(layout.arrows[0][1].x, 900);
    expect(layout.arrows[1][0]).toEqual({ x: 0, y: 300 });
    near(layout.arrows[1][1].x, 100);
  });

  it("no extension lines when the origins are as near as the offset to the dimension line", () => {
    const d = horizontal({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 50 });
    expect(layoutOf(d).segments).toHaveLength(1);
    const far = horizontal({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 51 });
    expect(layoutOf(far).segments).toHaveLength(3);
  });

  it("extension lines go toward the dimension line, whichever side it is on", () => {
    const below = layoutOf(horizontal({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: -600 }));
    expect(below.segments[0]).toEqual([
      { x: 0, y: -50 },
      { x: 0, y: -650 },
    ]);
  });

  it("text sits above the line when it fits between the arrows, and beyond the end when it does not", () => {
    // 文字 "1000" の幅 = 4 × 0.65 × 100 = 260。長さ 1000 は収まる
    const fits = layoutOf(horizontal({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 300 }));
    expect(fits.text.verticalAlign).toBe("bottom");
    near(fits.text.position.x, 500);
    near(fits.text.position.y, 300 + 30);
    // 長さ 300: 文字 "300" の幅 195 + 矢印 200 > 300 なので収まらず、終点の外へ
    const outside = layoutOf(horizontal({ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 150, y: 300 }));
    expect(outside.text.verticalAlign).toBe("middle");
    expect(outside.text.position.x).toBeGreaterThan(300);
    near(outside.text.position.y, 300);
    // 矢印は内側のまま(長さ 300 ≥ 矢印 2 本分 200)
    near(outside.arrows[0][1].x, 100);
    expect(outside.segments).toHaveLength(3);
  });

  it("arrows turn outside when the dimension is shorter than two arrows", () => {
    const d = horizontal({ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 75, y: 300 });
    const layout = layoutOf(d);
    // 寸法線 + 補助線 2 本 + 外側の線 2 本
    expect(layout.segments).toHaveLength(5);
    // 左の矢印は、先が左端で、根元は外側(左)
    expect(layout.arrows[0][0]).toEqual({ x: 0, y: 300 });
    near(layout.arrows[0][1].x, -100);
    // 右の矢印の根元は外側(右)
    near(layout.arrows[1][1].x, 250);
    // 文字は、外側の線のさらに先
    expect(layout.text.position.x).toBeGreaterThan(150 + 200);
  });

  it("is not computable for zero length, non-finite values and unusable style values", () => {
    expect(layoutDimension(horizontal({ x: 5, y: 0 }, { x: 5, y: 100 }, { x: 0, y: 50 }))).toBeNull();
    expect(layoutDimension(dimension({ kind: "aligned", p1: { x: 1, y: 1 }, p2: { x: 1, y: 1 }, position: { x: 0, y: 0 } }))).toBeNull();
    expect(layoutDimension(horizontal({ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 0, y: 5 }))).toBeNull();
    expect(layoutDimension(horizontal({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: Infinity }))).toBeNull();
    expect(layoutDimension(horizontal({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 5 }, { ...VALUES, textHeight: 0 }))).toBeNull();
    expect(layoutDimension(horizontal({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 5 }, { ...VALUES, arrowSize: Number.NaN }))).toBeNull();
    expect(layoutDimension(horizontal({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 5 }, { ...VALUES, extensionOffset: -1 }))).toBeNull();
    expect(layoutDimension(dimension({ kind: "linear", p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, position: { x: 0, y: 1 }, rotation: Number.NaN }))).toBeNull();
    // 桁あふれで、計算結果が有限でなくなる
    expect(layoutDimension(horizontal({ x: -1e308, y: 0 }, { x: 1e308, y: 0 }, { x: 0, y: 1 }))).toBeNull();
    // 入力は有限で、長さも有限でも、途中の値(矢印を外に出す線の長さ)が桁あふれする
    expect(layoutDimension(horizontal({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 30 }, { ...VALUES, arrowSize: 1e308 }))).toBeNull();
  });
});

describe("style values the layout can use", () => {
  it("is not computable with an unknown unit, or decimals that are not numbers", () => {
    const base = horizontal({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 30 });
    expect(layoutDimension(base)).not.toBeNull();
    expect(layoutDimension({ ...base, values: { ...VALUES, unit: "km" as never } })).toBeNull();
    expect(layoutDimension({ ...base, values: { ...VALUES, decimals: Number.NaN } })).toBeNull();
    expect(layoutDimension({ ...base, values: { ...VALUES, angleDecimals: Infinity } })).toBeNull();
    expect(layoutDimension({ ...base, values: { ...VALUES, showUnit: "yes" as never } })).toBeNull();
  });
});

describe("radius and diameter", () => {
  const circle = { p1: { x: 1000, y: 1000 }, p2: { x: 1250, y: 1000 } };

  it("radius: the arrow tip is on the circle toward the text side, and the line runs from it to the position", () => {
    const d = dimension({ kind: "radius", ...circle, position: { x: 1000, y: 1600 } });
    const layout = layoutOf(d);
    near(layout.value, 250);
    expect(layout.text.text).toBe("R250");
    expect(layout.segments).toEqual([[{ x: 1000, y: 1250 }, { x: 1000, y: 1600 }]]);
    expect(layout.arrows[0][0]).toEqual({ x: 1000, y: 1250 });
    // 矢印は円周から文字の側(上)へ向かう根元
    near(layout.arrows[0][1].y, 1350);
    // 文字は線の先(上)
    expect(layout.text.position.y).toBeGreaterThan(1600);
    near(layout.text.rotation, Math.PI / 2);
  });

  it("radius with the text side inside the circle: the line goes from the tip inward", () => {
    const d = dimension({ kind: "radius", ...circle, position: { x: 1100, y: 1000 } });
    const layout = layoutOf(d);
    expect(layout.segments[0][0]).toEqual({ x: 1250, y: 1000 });
    // 内側の点までが矢印 2 本分(200)より短いので、200 に延ばす
    near(layout.segments[0][1].x, 1050);
  });

  it("radius with the text side at the center falls back to the direction of the picked point", () => {
    const d = dimension({ kind: "radius", ...circle, position: { x: 1000, y: 1000 } });
    const layout = layoutOf(d);
    expect(layout.arrows[0][0]).toEqual({ x: 1250, y: 1000 });
  });

  it("diameter: a line through the center in the direction of the text side, value = 2 r", () => {
    const d = dimension({ kind: "diameter", ...circle, position: { x: 1000, y: 2000 } });
    const layout = layoutOf(d);
    near(layout.value, 500);
    expect(layout.text.text).toBe("Ø500");
    expect(layout.segments).toEqual([[{ x: 1000, y: 750 }, { x: 1000, y: 1250 }]]);
    expect(layout.arrows[0][0]).toEqual({ x: 1000, y: 750 });
    expect(layout.arrows[1][0]).toEqual({ x: 1000, y: 1250 });
  });

  it("is not computable for a zero radius", () => {
    expect(layoutDimension(dimension({ kind: "radius", p1: { x: 5, y: 5 }, p2: { x: 5, y: 5 }, position: { x: 9, y: 9 } }))).toBeNull();
    expect(layoutDimension(dimension({ kind: "diameter", p1: { x: 5, y: 5 }, p2: { x: 5, y: 5 }, position: { x: 9, y: 9 } }))).toBeNull();
  });
});

describe("angular dimensions", () => {
  const angular = (position: Point2D, arm1: Point2D = { x: 1000, y: 0 }, arm2: Point2D = { x: 0, y: 1000 }): CadDimension =>
    dimension({ kind: "angular", p1: { x: 0, y: 0 }, p2: arm1, p3: arm2, position });

  it("measures the angle on the side of the position (90 degrees between +X and +Y)", () => {
    const layout = layoutOf(angular({ x: 700, y: 700 }));
    near(layout.value, Math.PI / 2);
    expect(layout.text.text).toBe("90.0°");
    expect(layout.arc).not.toBeNull();
    near(layout.arc!.radius, Math.hypot(700, 700));
    near(layout.arc!.startAngle, 0);
    near(layout.arc!.sweep, Math.PI / 2);
  });

  it("measures the reflex side (270 degrees) when the position is on the other side", () => {
    const layout = layoutOf(angular({ x: -700, y: -700 }));
    near(layout.value, (3 * Math.PI) / 2);
    expect(layout.text.text).toBe("270.0°");
    // 弧は +Y の腕から、反時計回りに +X の腕まで
    near(layout.arc!.startAngle, Math.PI / 2);
  });

  it("collinear opposite arms measure 180 degrees on either side", () => {
    const above = layoutOf(angular({ x: 0, y: 500 }, { x: 1000, y: 0 }, { x: -1000, y: 0 }));
    near(above.value, Math.PI);
    const below = layoutOf(angular({ x: 0, y: -500 }, { x: 1000, y: 0 }, { x: -1000, y: 0 }));
    near(below.value, Math.PI);
  });

  it("draws extension lines only when an arm point is short of the arc", () => {
    const far = layoutOf(angular({ x: 1500, y: 1500 }, { x: 500, y: 0 }, { x: 0, y: 500 }));
    expect(far.segments).toHaveLength(2);
    const reaching = layoutOf(angular({ x: 300, y: 300 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }));
    expect(reaching.segments).toHaveLength(0);
    // 弧の半径が、腕の端から補助線の間隔(50)以内のときは、補助線を引かない(間隔の分だけ離れて始まるので、引く長さが無い)
    const closeToArm = layoutOf(angular({ x: 520, y: 0.0001 }, { x: 500, y: 0 }, { x: 0, y: 500 }));
    expect(closeToArm.segments).toHaveLength(0);
    const beyondOffset = layoutOf(angular({ x: 560, y: 0.0001 }, { x: 500, y: 0 }, { x: 0, y: 500 }));
    expect(beyondOffset.segments.length).toBeGreaterThan(0);
  });

  it("arrows sit on the arc ends, pointing along the arc", () => {
    const layout = layoutOf(angular({ x: 700, y: 700 }));
    const r = Math.hypot(700, 700);
    expect(layout.arrows).toHaveLength(2);
    near(layout.arrows[0][0].x, r);
    near(layout.arrows[0][0].y, 0, 6);
    near(layout.arrows[1][0].x, 0, 6);
    near(layout.arrows[1][0].y, r);
    // 開始の矢印の根元は、弧の内側(+Y 方向)
    expect(layout.arrows[0][1].y).toBeGreaterThan(0);
  });

  it("is not computable when the arms coincide, the position is at the vertex or an arm is zero", () => {
    expect(layoutDimension(angular({ x: 700, y: 700 }, { x: 1000, y: 0 }, { x: 500, y: 0 }))).toBeNull();
    expect(layoutDimension(angular({ x: 0, y: 0 }))).toBeNull();
    expect(layoutDimension(angular({ x: 700, y: 700 }, { x: 0, y: 0 }, { x: 0, y: 1000 }))).toBeNull();
    expect(layoutDimension(dimension({ kind: "angular", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, position: { x: 5, y: 5 } }))).toBeNull();
  });

  it("is not computable when an arm vector overflows (the direction would be wrong: atan2(1e308, Infinity) is 0, not 0.38 rad)", () => {
    const overflowing = dimension({ kind: "angular", p1: { x: -1e308, y: 0 }, p2: { x: 1.5e308, y: 1e308 }, p3: { x: -1e308, y: 1000 }, position: { x: -1e308 + 5, y: 5 } });
    expect(layoutDimension(overflowing)).toBeNull();
    expect(layoutDimension(dimension({ kind: "angular", p1: { x: -1e308, y: 0 }, p2: { x: 1000, y: 0 }, p3: { x: 0, y: 1000 }, position: { x: 0, y: 5 } }))).toBeNull();
  });
});

describe("selection and bounds", () => {
  const d = horizontal({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 600 });

  it("picks on the dimension line, an extension line, an arrow and anywhere inside the text box", () => {
    const entities: CadEntity[] = [d];
    const visible = new Set(["0"]);
    const hit = (x: number, y: number): boolean => findEntitiesNearPoint(entities, visible, { x, y }, 5).length === 1;
    expect(hit(300, 600)).toBe(true); // 寸法線
    expect(hit(0, 300)).toBe(true); // 寸法補助線
    expect(hit(50, 600)).toBe(true); // 矢印の中
    const layout = layoutOf(d);
    expect(hit(layout.text.position.x, layout.text.position.y + 40)).toBe(true); // 文字の中
    expect(hit(300, 300)).toBe(false); // 何も無い所
    expect(hit(500, 900)).toBe(false);
  });

  it("is not pickable on a hidden layer", () => {
    expect(findEntitiesNearPoint([d], new Set(["other"]), { x: 300, y: 600 }, 5)).toHaveLength(0);
  });

  it("window selection needs everything inside; crossing needs a touch (including a box fully inside the text)", () => {
    const layout = layoutOf(d);
    const all = { min: { x: -1000, y: -1000 }, max: { x: 2000, y: 2000 } };
    expect(isEntityFullyInsideBox(d, all)).toBe(true);
    expect(isEntityFullyInsideBox(d, { min: { x: -100, y: -100 }, max: { x: 600, y: 700 } })).toBe(false);
    expect(isEntityTouchingBox(d, { min: { x: -100, y: -100 }, max: { x: 600, y: 700 } })).toBe(true);
    expect(isEntityTouchingBox(d, { min: { x: 2000, y: 2000 }, max: { x: 3000, y: 3000 } })).toBe(false);
    const t = layout.text.position;
    expect(isEntityTouchingBox(d, { min: { x: t.x - 5, y: t.y + 30 }, max: { x: t.x + 5, y: t.y + 40 } })).toBe(true);
  });

  it("crossing selection uses the real lines only: a box that touches nothing but the gap between two lines does not select it", () => {
    // 寸法線 (y = 600)・補助線 (x = 0 と x = 1000)・矢印・文字から離れた (500, 350) の近く(点を順に結んだだけの折れ線なら、補助線の端どうしを結ぶ線が通る所)
    expect(isEntityTouchingBox(d, { min: { x: 495, y: 345 }, max: { x: 505, y: 355 } })).toBe(false);
    // 補助線 (x = 1000) の途中だけに触れる箱は、選択される(端点は箱の外)
    expect(isEntityTouchingBox(d, { min: { x: 995, y: 400 }, max: { x: 1005, y: 410 } })).toBe(true);
  });

  it("bounds cover the lines, the arrows and the text (and the defining points when it is not computable)", () => {
    const bounds = computeAllEntityBounds([d]);
    expect(bounds[0]).toBeLessThanOrEqual(0);
    // 寸法補助線の始まり(起点から 50 離れた y = 50)
    near(bounds[1], 50);
    expect(bounds[2]).toBeGreaterThanOrEqual(1000);
    // 寸法補助線の先(y = 650)と、文字の上端を含む
    const layout = layoutOf(d);
    expect(bounds[3]).toBeGreaterThanOrEqual(layout.text.position.y + 100);
    const broken = horizontal({ x: 10, y: 0 }, { x: 10, y: 0 }, { x: 50, y: 70 });
    expect(Array.from(computeAllEntityBounds([broken]))).toEqual([10, 0, 50, 70]);
  });

  it("the arc of an angular dimension is picked on the true arc (not on a 48-segment polyline), and the bounds reach its extreme", () => {
    // 頂点が原点、腕が -50 度と 40 度の向き、弧の半径 10000(位置は 0 度の向き)。折れ線(7.5 度ごと)の弦は、弧から最大 約21 mm 内側になる
    const rad = (deg: number): number => (deg * Math.PI) / 180;
    const arms = dimension({ kind: "angular", p1: { x: 0, y: 0 }, p2: { x: Math.cos(rad(-50)) * 20000, y: Math.sin(rad(-50)) * 20000 }, p3: { x: Math.cos(rad(40)) * 20000, y: Math.sin(rad(40)) * 20000 }, position: { x: 10000, y: 0 } });
    const onArc = { x: 10000 * Math.cos(rad(-50 + 3.75)), y: 10000 * Math.sin(rad(-50 + 3.75)) }; // 折れ線の頂点と頂点の、ちょうど中間の角度
    expect(distanceFromPointToDimension(arms, onArc)).toBeLessThan(1e-6);
    expect(findEntitiesNearPoint([arms], new Set(["0"]), onArc, 2)).toHaveLength(1);
    // 範囲は、弧の x 方向の極値(0 度の向きの点 x = 10000)に届く(頂点だけでは 9962 まで)
    expect(computeAllEntityBounds([arms])[2]).toBeGreaterThanOrEqual(10000 - 1e-6);
    // 弧から離れた点は、離れている
    expect(distanceFromPointToDimension(arms, { x: 10100, y: 0 })).toBeGreaterThan(90);
    // 弧の角度の範囲の外(90度の向き、半径 10000 の円の上)は、円周上でも、弧からは遠い(近い方の端まで 約8450 mm)
    expect(distanceFromPointToDimension(arms, { x: 0, y: 10000 })).toBeGreaterThan(8000);
  });

  it("a dimension that cannot be computed is still selectable on the polyline through its defining points", () => {
    const broken = horizontal({ x: 10, y: 0 }, { x: 10, y: 0 }, { x: 50, y: 70 });
    expect(distanceFromPointToDimension(broken, { x: 10, y: 0 })).toBe(0);
    expect(getEntitySegments(broken).length).toBeGreaterThan(0);
    expect(getEntityPoints(broken)).toHaveLength(3);
  });

  it("text entity for layout has the text's placement", () => {
    const layout = layoutOf(d);
    const text = dimensionTextEntity(d, layout);
    expect(text).toMatchObject({ type: "TEXT", id: "d1", text: "1000", height: 100, horizontalAlign: "center", verticalAlign: "bottom" });
  });
});

describe("transforms", () => {
  const base = horizontal({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 300 });
  const asDimension = (e: CadEntity): CadDimension => {
    if (e.type !== "DIMENSION") throw new Error("寸法ではありません");
    return e;
  };

  it("a move shifts all the defining points; the direction and the style values stay the same", () => {
    const moved = asDimension(transformEntityGeometry(base, translationMatrix(10, 20)));
    expect(moved.p1).toEqual({ x: 10, y: 20 });
    expect(moved.p2).toEqual({ x: 1010, y: 20 });
    expect(moved.position).toEqual({ x: 510, y: 320 });
    expect(moved.rotation).toBe(0);
    expect(moved.values).toBe(base.values);
    near(layoutOf(moved).value, 1000);
  });

  it("a rotation turns the dimension line direction with the points: the measured length is kept", () => {
    const turned = asDimension(transformEntityGeometry(base, rotationMatrix({ x: 0, y: 0 }, Math.PI / 2)));
    near(turned.rotation ?? 0, Math.PI / 2);
    near(layoutOf(turned).value, 1000);
    const layout = layoutOf(turned);
    near(layout.text.rotation, Math.PI / 2);
    // 45度回転しても、測る長さは同じ
    const diagonal = asDimension(transformEntityGeometry(base, rotationMatrix({ x: 100, y: 100 }, Math.PI / 4)));
    near(layoutOf(diagonal).value, 1000);
  });

  it("a mirror keeps the measured value and maps the direction", () => {
    const axis = reflectionMatrix({ x: 0, y: 0 }, { x: 1, y: 1 });
    if (axis === null) throw new Error("鏡像の行列が作れません");
    const mirrored = asDimension(transformEntityGeometry(base, axis));
    near(layoutOf(mirrored).value, 1000);
    near(mirrored.rotation ?? 0, Math.PI / 2);
    expect(mirrored.p2.x).toBeCloseTo(0);
    expect(mirrored.p2.y).toBeCloseTo(1000);
  });

  it("a scale changes the measured value, but not the text height or the arrow size", () => {
    const scaled = asDimension(transformEntityGeometry(base, scaleMatrix({ x: 0, y: 0 }, 2)));
    near(layoutOf(scaled).value, 2000);
    expect(scaled.values.textHeight).toBe(100);
    expect(scaled.values.arrowSize).toBe(100);
    expect(scaled.p2).toEqual({ x: 2000, y: 0 });
  });

  it("an aligned dimension and an angular dimension follow a rotation", () => {
    const aligned = dimension({ kind: "aligned", p1: { x: 0, y: 0 }, p2: { x: 300, y: 400 }, position: { x: 100, y: 400 } });
    const turned = asDimension(transformEntityGeometry(aligned, rotationMatrix({ x: 0, y: 0 }, 1)));
    near(layoutOf(turned).value, 500);
    const angular = dimension({ kind: "angular", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, p3: { x: 0, y: 1000 }, position: { x: 700, y: 700 } });
    const rotated = asDimension(transformEntityGeometry(angular, rotationMatrix({ x: 0, y: 0 }, 0.7)));
    near(layoutOf(rotated).value, Math.PI / 2);
    const axis = reflectionMatrix({ x: 0, y: 0 }, { x: 1, y: 0 });
    const mirrored = asDimension(transformEntityGeometry(angular, axis!));
    near(layoutOf(mirrored).value, Math.PI / 2);
  });

  it("refuses a transform that overflows", () => {
    expect(() => transformEntityGeometry(base, translationMatrix(Number.MAX_VALUE, 0))).not.toThrow();
    const huge = horizontal({ x: 1e308, y: 0 }, { x: 1e308, y: 1 }, { x: 1e308, y: 5 });
    expect(() => transformEntityGeometry(huge, scaleMatrix({ x: 0, y: 0 }, 10))).toThrow();
  });
});

describe("stretch", () => {
  const base = horizontal({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 300 });
  const window = (minX: number, minY: number, maxX: number, maxY: number) => ({ min: { x: minX, y: minY }, max: { x: maxX, y: maxY } });

  it("moves only the defining points inside the window (the measured length changes)", () => {
    const outcome = stretchEntityGeometry(base, window(900, -100, 1100, 100), 200, 0);
    expect(outcome.kind).toBe("reshaped");
    if (outcome.kind !== "reshaped" || outcome.entity.type !== "DIMENSION") throw new Error("reshaped ではありません");
    expect(outcome.entity.p2).toEqual({ x: 1200, y: 0 });
    expect(outcome.entity.p1).toEqual({ x: 0, y: 0 });
    near(layoutOf(outcome.entity).value, 1200);
  });

  it("moves the dimension line when only the position is inside the window", () => {
    const outcome = stretchEntityGeometry(base, window(400, 200, 600, 400), 0, 100);
    expect(outcome.kind).toBe("reshaped");
    if (outcome.kind !== "reshaped" || outcome.entity.type !== "DIMENSION") throw new Error("reshaped ではありません");
    expect(outcome.entity.position).toEqual({ x: 500, y: 400 });
    expect(outcome.entity.p2).toEqual({ x: 1000, y: 0 });
  });

  it("moves it as a whole when everything is inside; nothing when nothing is", () => {
    expect(stretchEntityGeometry(base, window(-10, -10, 1100, 400), 5, 5).kind).toBe("moved");
    expect(stretchEntityGeometry(base, window(5000, 5000, 6000, 6000), 5, 5).kind).toBe("unchanged");
  });

  it("radius, diameter and angular dimensions move only as a whole (a partial window is skipped)", () => {
    const radius = dimension({ kind: "radius", p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, position: { x: 400, y: 0 } });
    expect(stretchEntityGeometry(radius, window(-10, -10, 150, 10), 5, 0).kind).toBe("partial-skipped");
    expect(stretchEntityGeometry(radius, window(-10, -10, 500, 10), 5, 0).kind).toBe("moved");
    const angular = dimension({ kind: "angular", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, p3: { x: 0, y: 1000 }, position: { x: 700, y: 700 } });
    expect(stretchEntityGeometry(angular, window(-10, -10, 10, 10), 5, 0).kind).toBe("partial-skipped");
  });
});
