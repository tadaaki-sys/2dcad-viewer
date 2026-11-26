// 寸法のコマンド(DIMHORIZONTAL・DIMVERTICAL・DIMALIGNED・DIMRADIUS・DIMDIAMETER・DIMANGULAR・DIMSTYLE)の進み方(Phase 15)
import { describe, expect, it } from "vitest";
import { DEFAULT_DIMENSION_STYLE } from "../../core/dimension/dimensionStyle";
import type { DimensionStyle } from "../../core/dimension/dimensionStyle";
import type { CadDimension, CadEntity } from "../../types/cad";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import { NO_EDITING } from "./types";
import type { AppCommandContext, AppEditing, AppRequest, PickKind } from "./types";

const CIRCLE: CadEntity = { id: "c1", type: "CIRCLE", layer: "0", color: "#fff", center: { x: 1000, y: 1000 }, radius: 250 };
const ARC: CadEntity = { id: "a1", type: "ARC", layer: "0", color: "#fff", center: { x: 0, y: 0 }, radius: 100, startAngle: 0, endAngle: Math.PI };
const LINE_X: CadEntity = { id: "lx", type: "LINE", layer: "0", color: "#fff", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } };
const LINE_Y: CadEntity = { id: "ly", type: "LINE", layer: "0", color: "#fff", start: { x: 0, y: 0 }, end: { x: 0, y: 1000 } };
const LINE_PARALLEL: CadEntity = { id: "lp", type: "LINE", layer: "0", color: "#fff", start: { x: 0, y: 500 }, end: { x: 1000, y: 500 } };
const POLY: CadEntity = { id: "pl", type: "LWPOLYLINE", layer: "0", color: "#fff", vertices: [{ x: 0, y: 0 }, { x: 5, y: 5 }], closed: false };
const DIM_H: CadDimension = {
  id: "d1", type: "DIMENSION", layer: "0", color: "#fff", kind: "aligned", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, position: { x: 500, y: -300 },
  values: { textHeight: 100, arrowSize: 100, decimals: 0, angleDecimals: 1, unit: "mm", showUnit: false, extensionOffset: 50 },
};
const DIM_R: CadDimension = { ...DIM_H, id: "d2", kind: "radius", p1: { x: 1000, y: 1000 }, p2: { x: 1250, y: 1000 }, position: { x: 1500, y: 1000 } };
const DIM_A: CadDimension = { ...DIM_H, id: "d3", kind: "angular", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, p3: { x: 0, y: 1000 }, position: { x: 700, y: 700 } };
const ENTITIES: Readonly<Record<string, CadEntity>> = { c1: CIRCLE, a1: ARC, lx: LINE_X, ly: LINE_Y, lp: LINE_PARALLEL, pl: POLY, d1: DIM_H, d2: DIM_R, d3: DIM_A };

/** クリックの位置の x で、指す図形を決める(100 = 円、200 = 円弧、300 = 横線、400 = 縦線、500 = 平行線、600 = 折れ線。それ以外は、図形なし) */
const PICKS: Readonly<Record<number, string>> = { 100: "c1", 200: "a1", 300: "lx", 400: "ly", 500: "lp", 600: "pl", 700: "d1", 710: "d2", 720: "d3" };

function start(context: Partial<AppCommandContext> = {}, editing: Partial<AppEditing> = {}) {
  const picks: Array<{ point: { x: number; y: number }; name: string; kind: PickKind | undefined }> = [];
  const state = makeContext({
    editing: {
      ...NO_EDITING,
      ready: true,
      pickEntity: (point, name, kind) => {
        picks.push({ point, name, kind });
        const id = PICKS[point.x];
        if (id === undefined) return { ok: false, message: `${name}: クリックした所に図形がありません` };
        const entity = ENTITIES[id];
        const allowed = kind === "circular" ? ["CIRCLE", "ARC"] : kind === "line" ? ["LINE"] : kind === "dimension" ? ["DIMENSION"] : ["LINE", "CIRCLE", "ARC", "LWPOLYLINE"];
        return allowed.includes(entity.type) ? { ok: true, id } : { ok: false, message: `${entity.type} は、${name}できません` };
      },
      entityOf: (id) => ENTITIES[id] ?? null,
      ...editing,
    },
    ...context,
  });
  return { session: createAppCommandSession(() => state), picks };
}

const addedDimension = (requests: readonly AppRequest[]): CadDimension => {
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (request.type !== "addEntities") throw new Error(`addEntities ではありません: ${request.type}`);
  expect(request.entities).toHaveLength(1);
  expect(request.label).toBe("寸法を追加");
  const entity = request.entities[0];
  if (entity.type !== "DIMENSION") throw new Error("寸法ではありません");
  return entity;
};

const NOTE: DimensionStyle = { ...DEFAULT_DIMENSION_STYLE, name: "Note", textHeight: 50, arrowSize: 40, decimals: 1, unit: "cm", showUnit: true, extensionOffset: 10, color: "#ffcc00", layer: "DIM", linetype: "dashed" };

describe("starting", () => {
  it("has the short names", () => {
    for (const [name, command] of [["dh", "DIMHORIZONTAL"], ["dimlinear", "DIMHORIZONTAL"], ["dv", "DIMVERTICAL"], ["dal", "DIMALIGNED"]] as const) {
      expect(start().session.submitText(name).active).toMatchObject({ name: command, expect: "point" });
    }
    for (const [name, command] of [["dra", "DIMRADIUS"], ["ddi", "DIMDIAMETER"], ["dan", "DIMANGULAR"]] as const) {
      expect(start().session.submitText(name).active).toMatchObject({ name: command, expect: "point", rawPoints: true });
    }
    expect(start().session.submitText("dst").requests).toEqual([{ type: "openDimensionStyles" }]);
    expect(start().session.submitText("dimstyle").requests).toEqual([{ type: "openDimensionStyles" }]);
  });

  it("without a document, while loading, or without a layer to draw on, nothing starts (DIMSTYLE needs no document)", () => {
    const closed = start({ isDocumentOpen: false }).session;
    for (const name of ["dimhorizontal", "dimvertical", "dimaligned", "dimradius", "dimdiameter", "dimangular"]) expect(closed.submitText(name).messages[0]).toContain("図面が開かれていません");
    expect(closed.submitText("dimstyle").requests).toEqual([{ type: "openDimensionStyles" }]);
    expect(start({}, { ready: false }).session.submitText("dh").messages[0]).toContain("準備中");
    const blocked = start({ drawTarget: { ok: false, reason: "このレイヤーには描けません" } }).session;
    expect(blocked.submitText("dh").messages[0]).toContain("このレイヤーには描けません");
    expect(blocked.submitText("dan").messages[0]).toContain("このレイヤーには描けません");
  });

  it("a style that names a layer draws there (and refuses when that layer is missing or hidden)", () => {
    const named: Partial<AppCommandContext> = {
      dimensionStyle: NOTE,
      layerTarget: (name) => (name === "DIM" ? { ok: true, layer: "DIM", color: "#00ff00" } : { ok: false, reason: `レイヤー「${name}」がありません` }),
    };
    expect(start(named).session.submitText("dh").active).toMatchObject({ name: "DIMHORIZONTAL" });
    const missing = start({ ...named, layerTarget: () => ({ ok: false, reason: "レイヤー「DIM」がありません" }) }).session.submitText("dh");
    expect(missing.active).toBeNull();
    expect(missing.messages[0]).toContain("Note");
    expect(missing.messages[0]).toContain("レイヤー「DIM」がありません");
  });
});

describe("DIMHORIZONTAL / DIMVERTICAL / DIMALIGNED", () => {
  it("first point → second point → dimension line position → ONE addEntities request with the current style's values", () => {
    const { session } = start({
      dimensionStyle: NOTE,
      layerTarget: () => ({ ok: true, layer: "DIM", color: "#00ff00" }),
    });
    const first = session.submitText("dh");
    expect(first.active?.prompt).toContain("Note");
    const second = session.submitPoint({ x: 0, y: 0 });
    expect(second.active).toMatchObject({ expect: "point", basePoint: { x: 0, y: 0 } });
    const position = session.submitPoint({ x: 1000, y: 300 });
    expect(position.requests).toEqual([]);
    expect(position.active).toMatchObject({ expect: "point", acceptsEnter: true });
    const done = session.submitPoint({ x: 500, y: 600 });
    expect(done.active).toBeNull();
    const dimension = addedDimension(done.requests);
    expect(dimension).toMatchObject({
      id: "n0",
      type: "DIMENSION",
      kind: "linear",
      rotation: 0,
      layer: "DIM",
      color: "#ffcc00",
      p1: { x: 0, y: 0 },
      p2: { x: 1000, y: 300 },
      position: { x: 500, y: 600 },
      styleName: "Note",
      values: { textHeight: 50, arrowSize: 40, decimals: 1, angleDecimals: 1, unit: "cm", showUnit: true, extensionOffset: 10 },
    });
    expect(dimension.lineDash?.name).toBe("破線");
    expect(done.messages[0]).toContain("水平寸法");
    expect(done.messages[0]).toContain("100.0 cm");
  });

  it("uses the layer's color when the style has none, the current layer when the style names none, and no dash for a continuous linetype", () => {
    const { session } = start({ drawTarget: { ok: true, layer: "WORK", color: "#abcdef" } });
    session.submitText("dv");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 100, y: 800 });
    const dimension = addedDimension(session.submitPoint({ x: -200, y: 400 }).requests);
    expect(dimension).toMatchObject({ kind: "linear", rotation: Math.PI / 2, layer: "WORK", color: "#abcdef", styleName: "Standard" });
    expect("lineDash" in dimension).toBe(false);
    expect(dimension.values).toMatchObject({ textHeight: 100, decimals: 0, unit: "mm", showUnit: false });
  });

  it("DIMALIGNED measures along the two points", () => {
    const { session } = start();
    session.submitText("dal");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 300, y: 400 });
    const done = session.submitPoint({ x: 100, y: 400 });
    const dimension = addedDimension(done.requests);
    expect(dimension.kind).toBe("aligned");
    expect("rotation" in dimension).toBe(false);
    expect(done.messages[0]).toContain("500");
  });

  it("the preview of the position step is the dimension at the cursor", () => {
    const { session } = start();
    session.submitText("dh");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 1000, y: 0 });
    const shapes = session.previewAt({ x: 500, y: 400 });
    // 寸法線 + 補助線 2 本 + 矢印 2 つ + 文字の枠
    expect(shapes.length).toBeGreaterThanOrEqual(6);
    expect(shapes.every((shape) => shape.kind === "polyline")).toBe(true);
    // 計算できない位置(寸法の長さが 0 になる、など)は、何も出さない
    expect(session.previewAt({ x: Number.NaN, y: 0 })).toEqual([]);
  });

  it("the second step's preview is the line to the cursor", () => {
    const { session } = start();
    session.submitText("dh");
    session.submitPoint({ x: 10, y: 10 });
    expect(session.previewAt({ x: 30, y: 10 })).toEqual([{ kind: "polyline", points: [{ x: 10, y: 10 }, { x: 30, y: 10 }], closed: false }]);
    expect(session.previewAt({ x: 10, y: 10 })).toEqual([]);
  });

  it("refuses the same point, and a zero distance in the measured direction; the second point is asked again", () => {
    const { session } = start();
    session.submitText("dh");
    session.submitPoint({ x: 0, y: 0 });
    const same = session.submitPoint({ x: 0, y: 0 });
    expect(same.messages[0]).toContain("同じ点");
    expect(same.active).toMatchObject({ basePoint: { x: 0, y: 0 } });
    const vertical = session.submitPoint({ x: 0, y: 500 });
    expect(vertical.messages[0]).toContain("水平方向の距離が 0");
    expect(vertical.requests).toEqual([]);
    expect(session.submitPoint({ x: 800, y: 500 }).active?.prompt).toContain("寸法線の位置");

    const v = start().session;
    v.submitText("dv");
    v.submitPoint({ x: 0, y: 0 });
    expect(v.submitPoint({ x: 500, y: 0 }).messages[0]).toContain("垂直方向の距離が 0");
  });

  it("a position that gives no computable dimension is refused with a reason, and can be retried", () => {
    const { session } = start();
    session.submitText("dh");
    session.submitPoint({ x: -1e308, y: 0 });
    session.submitPoint({ x: 1e308, y: 0 });
    const refused = session.submitPoint({ x: 0, y: 100 });
    expect(refused.requests).toEqual([]);
    expect(refused.active).not.toBeNull();
    expect(refused.messages[0]).toContain("寸法を作れません");
  });

  it("Enter ends at any step without adding anything", () => {
    for (const clicks of [0, 1, 2]) {
      const { session } = start();
      session.submitText("dal");
      for (let i = 0; i < clicks; i++) session.submitPoint({ x: i * 100 + 10, y: i * 50 });
      const ended = session.submitText("");
      expect(ended.active).toBeNull();
      expect(ended.requests).toEqual([]);
      expect(ended.messages[0]).toContain("寸法は描かれませんでした");
    }
  });

  it("Esc cancels without adding anything", () => {
    const { session } = start();
    session.submitText("dh");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 100, y: 0 });
    const cancelled = session.cancel();
    expect(cancelled.requests).toEqual([]);
    expect(session.active).toBeNull();
  });

  it("each dimension gets its own id", () => {
    const { session } = start();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      session.submitText("dh");
      session.submitPoint({ x: 0, y: 0 });
      session.submitPoint({ x: 100, y: 0 });
      ids.push(addedDimension(session.submitPoint({ x: 50, y: 50 }).requests).id);
    }
    expect(ids).toEqual(["n0", "n1"]);
  });
});

describe("DIMRADIUS / DIMDIAMETER", () => {
  it("pick a circle → the text side → radius dimension with the center and a point on the circle toward the click", () => {
    const { session, picks } = start();
    expect(session.submitText("dra").active).toMatchObject({ rawPoints: true });
    // 円をクリック(x = 100 → 円)。クリックの位置は、円の中心から見て、上の向き
    const text = session.submitPoint({ x: 100, y: 5000 });
    expect(picks).toEqual([{ point: { x: 100, y: 5000 }, name: "寸法", kind: "circular" }]);
    expect(text.active?.prompt).toContain("文字の側");
    const done = session.submitPoint({ x: 1000, y: 1600 });
    const dimension = addedDimension(done.requests);
    expect(dimension).toMatchObject({ kind: "radius", p1: { x: 1000, y: 1000 }, position: { x: 1000, y: 1600 } });
    // 円周上の点は、中心から、クリックの向き(上)へ半径 250
    const length = Math.hypot(100 - 1000, 5000 - 1000);
    expect(dimension.p2.x).toBeCloseTo(1000 + ((100 - 1000) / length) * 250);
    expect(dimension.p2.y).toBeCloseTo(1000 + ((5000 - 1000) / length) * 250);
    expect(Math.hypot(dimension.p2.x - 1000, dimension.p2.y - 1000)).toBeCloseTo(250);
    expect(done.messages[0]).toContain("R250");
  });

  it("diameter on an arc", () => {
    const { session } = start();
    session.submitText("ddi");
    session.submitPoint({ x: 200, y: 50 });
    const done = session.submitPoint({ x: 300, y: 300 });
    const dimension = addedDimension(done.requests);
    expect(dimension).toMatchObject({ kind: "diameter", p1: { x: 0, y: 0 } });
    expect(done.messages[0]).toContain("200");
  });

  it("refuses a click on nothing, and on a figure that is not a circle or an arc (the click is asked again)", () => {
    const { session } = start();
    session.submitText("dra");
    const nothing = session.submitPoint({ x: 9999, y: 0 });
    expect(nothing.messages[0]).toContain("クリックした所に図形がありません");
    expect(nothing.active).toMatchObject({ rawPoints: true });
    const line = session.submitPoint({ x: 300, y: 0 });
    expect(line.messages[0]).toContain("できません");
    expect(line.active?.prompt).toContain("円または円弧");
    expect(line.requests).toEqual([]);
  });

  it("refuses when the picked figure has vanished", () => {
    const { session } = start({}, { entityOf: () => null });
    session.submitText("dra");
    const gone = session.submitPoint({ x: 100, y: 0 });
    expect(gone.messages[0]).toContain("見つからない");
    expect(gone.active?.prompt).toContain("円または円弧");
  });

  it("Enter ends without adding anything", () => {
    const { session } = start();
    session.submitText("dra");
    session.submitPoint({ x: 100, y: 0 });
    const ended = session.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.active).toBeNull();
  });

  it("the position step previews the dimension", () => {
    const { session } = start();
    session.submitText("dra");
    session.submitPoint({ x: 100, y: 5000 });
    expect(session.previewAt({ x: 1000, y: 1600 }).length).toBeGreaterThanOrEqual(3);
  });
});

describe("DIMANGULAR", () => {
  it("two lines → the arc position → angular dimension of the wedge containing the position", () => {
    const { session, picks } = start();
    expect(session.submitText("dan").active?.prompt).toContain("1本目の線");
    const second = session.submitPoint({ x: 300, y: 0 });
    expect(second.active?.prompt).toContain("2本目の線");
    const position = session.submitPoint({ x: 400, y: 0 });
    expect(position.active?.prompt).toContain("弧が通る点");
    expect(picks.map((p) => p.kind)).toEqual(["line", "line"]);
    const done = session.submitPoint({ x: 500, y: 500 });
    const dimension = addedDimension(done.requests);
    expect(dimension).toMatchObject({ kind: "angular", p1: { x: 0, y: 0 }, position: { x: 500, y: 500 } });
    expect(dimension.p2).toMatchObject({ x: 1000, y: 0 });
    expect(dimension.p3).toMatchObject({ x: 0, y: 1000 });
    expect(done.messages[0]).toContain("90.0°");
  });

  it("the other wedge is measured when the position is on the other side", () => {
    const { session } = start();
    session.submitText("dan");
    session.submitPoint({ x: 300, y: 0 });
    session.submitPoint({ x: 400, y: 0 });
    const done = session.submitPoint({ x: -500, y: 500 });
    const dimension = addedDimension(done.requests);
    expect(dimension.p2.x).toBeLessThan(0);
    expect(dimension.p3?.y).toBeGreaterThan(0);
    expect(done.messages[0]).toContain("90.0°");
  });

  it("refuses a polyline, a click on nothing, and parallel lines (the click is asked again)", () => {
    const { session } = start();
    session.submitText("dan");
    expect(session.submitPoint({ x: 600, y: 0 }).messages[0]).toContain("できません");
    expect(session.submitPoint({ x: 9999, y: 0 }).messages[0]).toContain("クリックした所に図形がありません");
    expect(session.submitPoint({ x: 300, y: 0 }).active?.prompt).toContain("2本目");
    expect(session.submitPoint({ x: 600, y: 0 }).messages[0]).toContain("できません");
    const parallel = session.submitPoint({ x: 500, y: 0 });
    expect(parallel.messages[0]).toContain("平行");
    expect(parallel.active?.prompt).toContain("2本目");
    expect(parallel.requests).toEqual([]);
    // 別の線を選び直せる
    expect(session.submitPoint({ x: 400, y: 0 }).active?.prompt).toContain("弧が通る点");
  });

  it("a position at the intersection (no direction) is refused with a reason, and can be retried", () => {
    const { session } = start();
    session.submitText("dan");
    session.submitPoint({ x: 300, y: 0 });
    session.submitPoint({ x: 400, y: 0 });
    const refused = session.submitPoint({ x: 0, y: 0 });
    expect(refused.requests).toEqual([]);
    expect(refused.messages[0]).toContain("寸法を作れません");
    expect(addedDimension(session.submitPoint({ x: 10, y: 10 }).requests).kind).toBe("angular");
  });

  it("Enter at the first prompt switches to three points: vertex, arm 1, arm 2, then the arc position", () => {
    const { session } = start();
    session.submitText("dan");
    const vertex = session.submitText("");
    expect(vertex.active?.prompt).toContain("頂点");
    const arm1 = session.submitPoint({ x: 0, y: 0 });
    expect(arm1.active?.prompt).toContain("1本目の腕");
    const arm2 = session.submitPoint({ x: 1000, y: 0 });
    expect(arm2.active?.prompt).toContain("2本目の腕");
    const position = session.submitPoint({ x: 0, y: 1000 });
    expect(position.active?.prompt).toContain("弧が通る点");
    const done = session.submitPoint({ x: 700, y: 700 });
    expect(addedDimension(done.requests)).toMatchObject({ kind: "angular", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, p3: { x: 0, y: 1000 } });
    expect(done.messages[0]).toContain("90.0°");
  });

  it("three points: a point at the vertex is refused; overlapping arms are refused at the end", () => {
    const { session } = start();
    session.submitText("dan");
    session.submitText("");
    session.submitPoint({ x: 0, y: 0 });
    expect(session.submitPoint({ x: 0, y: 0 }).messages[0]).toContain("頂点と同じ点");
    session.submitPoint({ x: 1000, y: 0 });
    expect(session.submitPoint({ x: 0, y: 0 }).messages[0]).toContain("頂点と同じ点");
    session.submitPoint({ x: 500, y: 0 });
    const refused = session.submitPoint({ x: 700, y: 700 });
    expect(refused.requests).toEqual([]);
    expect(refused.messages[0]).toContain("寸法を作れません");
  });

  it("Enter in the middle of the three-point steps ends without adding anything", () => {
    const { session } = start();
    session.submitText("dan");
    session.submitText("");
    session.submitPoint({ x: 0, y: 0 });
    const ended = session.submitText("");
    expect(ended.active).toBeNull();
    expect(ended.requests).toEqual([]);
  });
});

// ---- Phase 16: 連動寸法 ----

/** 点が一致する図形の位置を返す(連動寸法が、測る点を図形に付けるのに使う)。"x,y" の文字で、図形の位置を決める */
const ANCHORS = (map: Record<string, { id: string; anchor: { kind: "start" | "end" | "mid" | "center" } }>): Partial<AppEditing> => ({
  anchorsAt: (points) => points.map((p) => map[`${p.x},${p.y}`] ?? null),
});

describe("associating at creation", () => {
  it("points that match a figure's endpoint / center become references; the others stay plain points; the message says how many", () => {
    const { session } = start({}, ANCHORS({ "0,0": { id: "lx", anchor: { kind: "start" } } }));
    session.submitText("dh");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 800, y: 0 });
    const done = session.submitPoint({ x: 400, y: -200 });
    const dimension = addedDimension(done.requests);
    expect(dimension.refs).toEqual([{ slot: "p1", id: "lx", anchor: { kind: "start" } }]);
    expect(done.messages.some((m) => m.includes("関連付けました(1か所)"))).toBe(true);
  });

  it("both points matched: two references; nothing matched: no refs property at all", () => {
    const both = start({}, ANCHORS({ "0,0": { id: "lx", anchor: { kind: "start" } }, "1000,0": { id: "lx", anchor: { kind: "end" } } }));
    both.session.submitText("dal");
    both.session.submitPoint({ x: 0, y: 0 });
    both.session.submitPoint({ x: 1000, y: 0 });
    expect(addedDimension(both.session.submitPoint({ x: 500, y: -200 }).requests).refs).toEqual([
      { slot: "p1", id: "lx", anchor: { kind: "start" } },
      { slot: "p2", id: "lx", anchor: { kind: "end" } },
    ]);
    const none = start();
    none.session.submitText("dv");
    none.session.submitPoint({ x: 0, y: 0 });
    none.session.submitPoint({ x: 100, y: 800 });
    const done = none.session.submitPoint({ x: -200, y: 400 });
    expect("refs" in addedDimension(done.requests)).toBe(false);
    expect(done.messages.some((m) => m.includes("関連付けました"))).toBe(false);
  });

  it("the preview does not ask for references (only the final click does, once)", () => {
    let calls = 0;
    const { session } = start({}, { anchorsAt: (points) => { calls++; return points.map(() => null); } });
    session.submitText("dh");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 1000, y: 0 });
    for (let i = 0; i < 5; i++) session.previewAt({ x: 500, y: 100 * i });
    expect(calls).toBe(0);
    session.submitPoint({ x: 500, y: -200 });
    expect(calls).toBe(1);
  });

  it("a refused position (no result) does not ask for references either", () => {
    let calls = 0;
    const { session } = start({}, { anchorsAt: (points) => { calls++; return points.map(() => null); } });
    session.submitText("dh");
    session.submitPoint({ x: -1e308, y: 0 });
    session.submitPoint({ x: 1e308, y: 0 });
    expect(session.submitPoint({ x: 0, y: 100 }).requests).toEqual([]);
    expect(calls).toBe(0);
  });

  it("radius and diameter reference the clicked circle / arc itself", () => {
    const radius = start();
    radius.session.submitText("dra");
    radius.session.submitPoint({ x: 100, y: 5000 });
    expect(addedDimension(radius.session.submitPoint({ x: 1000, y: 1600 }).requests).refs).toEqual([{ slot: "figure", id: "c1", anchor: { kind: "whole" } }]);
    const diameter = start();
    diameter.session.submitText("ddi");
    diameter.session.submitPoint({ x: 200, y: 50 });
    expect(addedDimension(diameter.session.submitPoint({ x: 300, y: 300 }).requests).refs).toEqual([{ slot: "figure", id: "a1", anchor: { kind: "whole" } }]);
  });

  it("an angular dimension by two lines references both lines; by three points, the matching points", () => {
    const lines = start();
    lines.session.submitText("dan");
    lines.session.submitPoint({ x: 300, y: 0 });
    lines.session.submitPoint({ x: 400, y: 0 });
    expect(addedDimension(lines.session.submitPoint({ x: 500, y: 500 }).requests).refs).toEqual([
      { slot: "line1", id: "lx", anchor: { kind: "whole" } },
      { slot: "line2", id: "ly", anchor: { kind: "whole" } },
    ]);
    const three = start({}, ANCHORS({ "0,0": { id: "lx", anchor: { kind: "start" } }, "1000,0": { id: "lx", anchor: { kind: "end" } } }));
    three.session.submitText("dan");
    three.session.submitText("");
    three.session.submitPoint({ x: 0, y: 0 });
    three.session.submitPoint({ x: 1000, y: 0 });
    three.session.submitPoint({ x: 0, y: 1000 });
    expect(addedDimension(three.session.submitPoint({ x: 700, y: 700 }).requests).refs).toEqual([
      { slot: "p1", id: "lx", anchor: { kind: "start" } },
      { slot: "p2", id: "lx", anchor: { kind: "end" } },
    ]);
  });
});

const reassociation = (requests: readonly AppRequest[]): CadDimension => {
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (request.type !== "reassociateDimension") throw new Error(`reassociateDimension ではありません: ${request.type}`);
  return request.dimension;
};

describe("DIMREASSOC", () => {
  it("DRE is the short name; it needs a document and a ready drawing", () => {
    expect(start().session.submitText("dre").active).toMatchObject({ name: "DIMREASSOC", expect: "point", rawPoints: true });
    expect(start({ isDocumentOpen: false }).session.submitText("dimreassoc").messages[0]).toContain("図面が開かれていません");
    expect(start({}, { ready: false }).session.submitText("dimreassoc").messages[0]).toContain("準備中");
  });

  it("refuses a click on nothing and on a figure that is not a dimension (asked again); Enter ends without a request", () => {
    const { session, picks } = start();
    session.submitText("dre");
    expect(session.submitPoint({ x: 9999, y: 0 }).messages[0]).toContain("クリックした所に図形がありません");
    const notDim = session.submitPoint({ x: 300, y: 0 });
    expect(notDim.messages[0]).toContain("できません");
    expect(picks.at(-1)?.kind).toBe("dimension");
    const ended = session.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.active).toBeNull();
  });

  it("a linear dimension: each point is clicked on a figure position (the point moves there) and becomes a reference", () => {
    const { session } = start({}, ANCHORS({ "5,5": { id: "lx", anchor: { kind: "start" } }, "995,5": { id: "lx", anchor: { kind: "end" } } }));
    session.submitText("dre");
    expect(session.submitPoint({ x: 700, y: 0 }).active?.prompt).toContain("1つ目の点");
    expect(session.submitPoint({ x: 5, y: 5 }).active?.prompt).toContain("2つ目の点");
    const done = session.submitPoint({ x: 995, y: 5 });
    const dimension = reassociation(done.requests);
    expect(dimension).toMatchObject({ id: "d1", p1: { x: 5, y: 5 }, p2: { x: 995, y: 5 }, position: { x: 500, y: -300 } });
    expect(dimension.refs).toEqual([
      { slot: "p1", id: "lx", anchor: { kind: "start" } },
      { slot: "p2", id: "lx", anchor: { kind: "end" } },
    ]);
    expect(done.messages[0]).toContain("関連付けました(2か所)");
  });

  it("a click that matches no figure position is refused with the reason (asked again); Enter keeps the point and tries to match it", () => {
    const { session } = start({}, ANCHORS({ "0,0": { id: "lx", anchor: { kind: "start" } } }));
    session.submitText("dre");
    session.submitPoint({ x: 700, y: 0 });
    const refused = session.submitPoint({ x: 333, y: 3 });
    expect(refused.messages[0]).toContain("一致しません");
    expect(refused.active?.prompt).toContain("1つ目の点");
    // Enter: 今の点 p1 = (0,0) は、図形の位置に一致する → 付く。p2 = (1000,0) は一致しない → 付かない
    expect(session.submitText("").active?.prompt).toContain("2つ目の点");
    const done = session.submitText("");
    const dimension = reassociation(done.requests);
    expect(dimension.p1).toEqual({ x: 0, y: 0 });
    expect(dimension.p2).toEqual({ x: 1000, y: 0 });
    expect(dimension.refs).toEqual([{ slot: "p1", id: "lx", anchor: { kind: "start" } }]);
  });

  it("with nothing to link, the dimension is still replaced (its old references are dropped) and the message says no point was linked", () => {
    const withRefs: CadDimension = { ...DIM_H, refs: [{ slot: "p1", id: "lx", anchor: { kind: "start" } }] };
    const { session } = start({}, { entityOf: (id) => (id === "d1" ? withRefs : ENTITIES[id] ?? null) });
    session.submitText("dre");
    session.submitPoint({ x: 700, y: 0 });
    session.submitText("");
    const done = session.submitText("");
    expect("refs" in reassociation(done.requests)).toBe(false);
    expect(done.messages[0]).toContain("関連付けた点はありません");
  });

  it("a radius dimension: click a circle (center and radius follow, the direction is kept); Enter ends unchanged", () => {
    const { session } = start();
    session.submitText("dre");
    expect(session.submitPoint({ x: 710, y: 0 }).active?.prompt).toContain("円または円弧");
    const done = session.submitPoint({ x: 200, y: 50 });
    const dimension = reassociation(done.requests);
    expect(dimension.p1).toEqual({ x: 0, y: 0 });
    // 向きは +X のまま、円弧の半径 100
    expect(dimension.p2.x).toBeCloseTo(100, 9);
    expect(dimension.p2.y).toBeCloseTo(0, 9);
    expect(dimension.refs).toEqual([{ slot: "figure", id: "a1", anchor: { kind: "whole" } }]);

    const keep = start().session;
    keep.submitText("dre");
    keep.submitPoint({ x: 710, y: 0 });
    const ended = keep.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.messages[0]).toContain("変更されませんでした");
  });

  it("a radius dimension refuses a line (asked again)", () => {
    const { session } = start();
    session.submitText("dre");
    session.submitPoint({ x: 710, y: 0 });
    const refused = session.submitPoint({ x: 300, y: 0 });
    expect(refused.messages[0]).toContain("できません");
    expect(refused.requests).toEqual([]);
  });

  it("an angular dimension: two lines give the vertex and arms again (by the dimension's arc position); the same line twice and parallel lines are refused", () => {
    const { session } = start();
    session.submitText("dre");
    expect(session.submitPoint({ x: 720, y: 0 }).active?.prompt).toContain("1本目の線");
    expect(session.submitPoint({ x: 300, y: 0 }).active?.prompt).toContain("2本目の線");
    expect(session.submitPoint({ x: 300, y: 0 }).messages[0]).toContain("同じ線");
    expect(session.submitPoint({ x: 500, y: 0 }).messages[0]).toContain("平行");
    const done = session.submitPoint({ x: 400, y: 0 });
    const dimension = reassociation(done.requests);
    expect(dimension.p1).toMatchObject({ x: 0, y: 0 });
    expect(dimension.refs).toEqual([
      { slot: "line1", id: "lx", anchor: { kind: "whole" } },
      { slot: "line2", id: "ly", anchor: { kind: "whole" } },
    ]);
    expect(dimension.position).toEqual({ x: 700, y: 700 });
  });

  it("an angular dimension: Enter at the first prompt switches to the three points (Enter keeps a point)", () => {
    const { session } = start({}, ANCHORS({ "0,0": { id: "lx", anchor: { kind: "start" } }, "1000,0": { id: "lx", anchor: { kind: "end" } } }));
    session.submitText("dre");
    session.submitPoint({ x: 720, y: 0 });
    expect(session.submitText("").active?.prompt).toContain("頂点");
    session.submitText("");
    session.submitText("");
    const done = session.submitText("");
    const dimension = reassociation(done.requests);
    expect(dimension.refs).toEqual([
      { slot: "p1", id: "lx", anchor: { kind: "start" } },
      { slot: "p2", id: "lx", anchor: { kind: "end" } },
    ]);
  });

  it("an angular result that cannot be computed is refused without a request", () => {
    const degenerate: CadDimension = { ...DIM_A, position: { x: 0, y: 0 } };
    const { session } = start({}, { entityOf: (id) => (id === "d3" ? degenerate : ENTITIES[id] ?? null) });
    session.submitText("dre");
    session.submitPoint({ x: 720, y: 0 });
    session.submitText("");
    session.submitText("");
    session.submitText("");
    const done = session.submitText("");
    expect(done.requests).toEqual([]);
    expect(done.messages[0]).toContain("計算できません");
  });
});