import { describe, expect, it } from "vitest";
import type { CadArc, CadCircle } from "../../types/cad";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import type { AppRequest } from "./types";

function start(overrides = {}) {
  const context = makeContext(overrides);
  return { session: createAppCommandSession(() => context), context };
}

function added(requests: readonly AppRequest[]) {
  const request = requests.find((r) => r.type === "addEntities");
  if (request === undefined || request.type !== "addEntities") throw new Error("addEntities request not found");
  return request;
}

describe("CIRCLE", () => {
  it("clicks: center then a point on the circle (radius = distance)", () => {
    const { session } = start();
    const first = session.submitText("circle");
    expect(first.active).toMatchObject({ name: "CIRCLE", expect: "point", acceptsEnter: true, hasPreview: false });
    const second = session.submitPoint({ x: 100, y: 100 });
    expect(second.active).toMatchObject({ expect: "point", keywords: ["D"], acceptsEnter: true, hasPreview: true });
    const done = session.submitPoint({ x: 400, y: 500 });
    expect(done.active).toBeNull();
    const request = added(done.requests);
    expect(request.label).toBe("円を追加");
    expect(request.entities).toHaveLength(1);
    expect(request.entities[0] as CadCircle).toEqual({ id: "n0", type: "CIRCLE", layer: "0", color: "#ffffff", center: { x: 100, y: 100 }, radius: 500 });
    expect(done.messages).toEqual(["円を追加しました(半径 500.000)"]);
  });

  it("typed radius (a plain number), typed center, and the alias C", () => {
    const { session } = start();
    session.submitText("c");
    session.submitText("1000,2000");
    const done = session.submitText("250");
    const circle = added(done.requests).entities[0] as CadCircle;
    expect(circle).toMatchObject({ center: { x: 1000, y: 2000 }, radius: 250 });
  });

  it("a typed point works as the radius point; relative coordinates start from the center", () => {
    const { session } = start();
    session.submitText("circle");
    session.submitPoint({ x: 10, y: 10 });
    const circle = added(session.submitText("@30,40").requests).entities[0] as CadCircle;
    expect(circle.radius).toBeCloseTo(50, 12);
  });

  it("D asks for a diameter number; the radius is half of it", () => {
    const { session } = start();
    session.submitText("circle");
    session.submitPoint({ x: 0, y: 0 });
    const asked = session.submitText("d");
    expect(asked.active).toMatchObject({ expect: "distance", acceptsEnter: true });
    expect(asked.requests).toEqual([]);
    const circle = added(session.submitText("300").requests).entities[0] as CadCircle;
    expect(circle.radius).toBe(150);
  });

  it("refuses a zero, negative or too large radius and keeps waiting", () => {
    const { session } = start();
    session.submitText("circle");
    session.submitPoint({ x: 0, y: 0 });
    for (const text of ["0", "-5", "1e3x", "99999999999"]) {
      const result = session.submitText(text);
      expect(result.requests, text).toEqual([]);
      expect(result.active, text).not.toBeNull();
    }
    // クリックが中心と同じ点でも作らない
    const sameClick = session.submitPoint({ x: 0, y: 0 });
    expect(sameClick.requests).toEqual([]);
    expect(sameClick.active).not.toBeNull();
    expect(sameClick.messages[0]).toContain("半径が小さすぎるか大きすぎます");
    // まだ続けられる
    expect(added(session.submitText("5").requests).entities).toHaveLength(1);
  });

  it("refuses a diameter that gives an unusable radius", () => {
    const { session } = start();
    session.submitText("circle");
    session.submitPoint({ x: 0, y: 0 });
    session.submitText("d");
    expect(session.submitText("0").requests).toEqual([]);
    expect(session.submitText("-10").requests).toEqual([]);
    expect(session.active).not.toBeNull();
  });

  it("Enter and Esc end without drawing, at every step", () => {
    const first = start().session;
    first.submitText("circle");
    expect(first.submitText("").messages).toEqual(["CIRCLE を終了しました(図形は描かれませんでした)"]);
    expect(first.active).toBeNull();

    const second = start().session;
    second.submitText("circle");
    second.submitPoint({ x: 1, y: 1 });
    const enter = second.submitText("");
    expect(enter.requests).toEqual([]);
    expect(enter.active).toBeNull();

    const third = start().session;
    third.submitText("circle");
    third.submitPoint({ x: 1, y: 1 });
    third.submitText("d");
    expect(third.submitText("").requests).toEqual([]);
    expect(third.active).toBeNull();

    const fourth = start().session;
    fourth.submitText("circle");
    fourth.submitPoint({ x: 1, y: 1 });
    const esc = fourth.cancel();
    expect(esc.requests).toEqual([]);
    expect(esc.active).toBeNull();
  });

  it("the rubber band follows the cursor as a circle; nothing for an unusable radius; never pending", () => {
    const { session } = start();
    session.submitText("circle");
    expect(session.previewAt({ x: 5, y: 5 })).toEqual([]);
    session.submitPoint({ x: 0, y: 0 });
    expect(session.previewAt({ x: 3, y: 4 })).toEqual([{ kind: "circle", center: { x: 0, y: 0 }, radius: 5 }]);
    expect(session.previewAt({ x: 0, y: 0 })).toEqual([]);
    expect(session.active?.hasPendingChanges).toBe(false);
  });

  it("does not draw without a drawing, on a hidden layer, or with a plain number at the center step", () => {
    const noDocument = start({ isDocumentOpen: false }).session.submitText("circle");
    expect(noDocument.active).toBeNull();
    expect(noDocument.requests).toEqual([]);
    const hidden = start({ drawTarget: { ok: false, reason: "非表示レイヤーには描けません" } }).session.submitText("circle");
    expect(hidden.messages).toEqual(["非表示レイヤーには描けません"]);

    const { session } = start();
    session.submitText("circle");
    const result = session.submitText("100");
    expect(result.requests).toEqual([]);
    expect(result.active).toMatchObject({ name: "CIRCLE", prompt: "円の中心を指示してください" });
  });

  it("an unrelated command can replace it; the half-made circle is dropped", () => {
    const { session } = start();
    session.submitText("circle");
    session.submitPoint({ x: 0, y: 0 });
    const result = session.run("LINE");
    expect(result.requests).toEqual([]);
    expect(result.active?.name).toBe("LINE");
  });
});

describe("ARC (3 points)", () => {
  it("start → through → end; the arc runs counter-clockwise through the middle point", () => {
    const { session } = start();
    const first = session.submitText("arc");
    expect(first.active).toMatchObject({ name: "ARC", keywords: ["C"], acceptsEnter: true });
    session.submitPoint({ x: 100, y: 0 });
    const third = session.submitPoint({ x: 0, y: 100 });
    expect(third.active).toMatchObject({ expect: "point", hasPreview: true });
    const done = session.submitPoint({ x: -100, y: 0 });
    expect(done.active).toBeNull();
    const arc = added(done.requests).entities[0] as CadArc;
    expect(added(done.requests).label).toBe("円弧を追加");
    expect(arc.type).toBe("ARC");
    expect(arc.id).toBe("n0");
    expect(arc.layer).toBe("0");
    expect(arc.color).toBe("#ffffff");
    expect(arc.center.x).toBeCloseTo(0, 9);
    expect(arc.center.y).toBeCloseTo(0, 9);
    expect(arc.radius).toBeCloseTo(100, 9);
    expect(arc.startAngle).toBeCloseTo(0, 9);
    expect(arc.endAngle).toBeCloseTo(Math.PI, 9);
  });

  it("clockwise input is stored counter-clockwise (start and end swapped)", () => {
    const { session } = start();
    session.submitText("a");
    session.submitText("100,0");
    session.submitText("0,-100");
    const arc = added(session.submitText("-100,0").requests).entities[0] as CadArc;
    expect(arc.startAngle).toBeCloseTo(Math.PI, 9);
    expect(arc.endAngle).toBeCloseTo(0, 9);
  });

  it("refuses collinear points and keeps waiting; the same through point as the start is refused", () => {
    const { session } = start();
    session.submitText("arc");
    session.submitPoint({ x: 0, y: 0 });
    const same = session.submitPoint({ x: 0, y: 0 });
    expect(same.messages[0]).toContain("始点と同じ点");
    expect(same.active?.prompt).toBe("円弧の通過点を指示してください");
    session.submitPoint({ x: 10, y: 10 });
    const line = session.submitPoint({ x: 20, y: 20 });
    expect(line.requests).toEqual([]);
    expect(line.messages[0]).toContain("円弧になりません");
    expect(line.active?.prompt).toBe("円弧の終点を指示してください");
    // 別の点なら続けられる
    expect(added(session.submitPoint({ x: 20, y: 0 }).requests).entities).toHaveLength(1);
  });

  it("rubber band: a line to the through point, then an arc (or the polyline when it is not an arc)", () => {
    const { session } = start();
    session.submitText("arc");
    session.submitPoint({ x: 0, y: 0 });
    expect(session.previewAt({ x: 0, y: 0 })).toEqual([]);
    expect(session.previewAt({ x: 5, y: 5 })).toEqual([{ kind: "polyline", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], closed: false }]);
    session.submitPoint({ x: 5, y: 5 });
    expect(session.previewAt({ x: 10, y: 10 })[0]).toMatchObject({ kind: "polyline" });
    const shapes = session.previewAt({ x: 10, y: 0 });
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ kind: "arc" });
  });

  it("Enter and Esc end without drawing", () => {
    for (const steps of [0, 1, 2]) {
      const { session } = start();
      session.submitText("arc");
      if (steps >= 1) session.submitPoint({ x: 0, y: 0 });
      if (steps >= 2) session.submitPoint({ x: 5, y: 5 });
      const enter = session.submitText("");
      expect(enter.requests).toEqual([]);
      expect(enter.messages).toEqual(["ARC を終了しました(図形は描かれませんでした)"]);
      expect(enter.active).toBeNull();
      session.submitText("arc");
      if (steps >= 1) session.submitPoint({ x: 0, y: 0 });
      const esc = session.cancel();
      expect(esc.requests).toEqual([]);
      expect(esc.active).toBeNull();
    }
  });
});

describe("ARC (C = center, start, end)", () => {
  it("center → start (radius) → end (direction only), counter-clockwise from the start", () => {
    const { session } = start();
    session.submitText("arc");
    const center = session.submitText("c");
    expect(center.active?.prompt).toBe("円弧の中心を指示してください");
    const startStep = session.submitPoint({ x: 10, y: 20 });
    expect(startStep.active?.prompt).toContain("始点");
    const endStep = session.submitPoint({ x: 15, y: 20 });
    expect(endStep.active).toMatchObject({ hasPreview: true });
    const done = session.submitPoint({ x: 10, y: 99 });
    const arc = added(done.requests).entities[0] as CadArc;
    expect(arc.center).toEqual({ x: 10, y: 20 });
    expect(arc.radius).toBeCloseTo(5, 12);
    expect(arc.startAngle).toBeCloseTo(0, 12);
    expect(arc.endAngle).toBeCloseTo(Math.PI / 2, 12);
  });

  it("refuses a start at the center, an end at the center and an end in the start direction", () => {
    const { session } = start();
    session.submitText("arc");
    session.submitText("c");
    session.submitPoint({ x: 0, y: 0 });
    const atCenter = session.submitPoint({ x: 0, y: 0 });
    expect(atCenter.messages[0]).toContain("半径が小さすぎるか大きすぎます");
    session.submitPoint({ x: 10, y: 0 });
    const endAtCenter = session.submitPoint({ x: 0, y: 0 });
    expect(endAtCenter.messages[0]).toContain("中心と同じ点");
    const sameDirection = session.submitPoint({ x: 50, y: 0 });
    expect(sameDirection.requests).toEqual([]);
    expect(sameDirection.messages[0]).toContain("同じ方向");
    expect(session.active).not.toBeNull();
    expect(added(session.submitPoint({ x: 0, y: 7 }).requests).entities).toHaveLength(1);
  });

  it("rubber band: a line from the center, then the arc", () => {
    const { session } = start();
    session.submitText("arc");
    session.submitText("c");
    session.submitPoint({ x: 0, y: 0 });
    expect(session.previewAt({ x: 4, y: 0 })).toEqual([{ kind: "polyline", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], closed: false }]);
    session.submitPoint({ x: 4, y: 0 });
    expect(session.previewAt({ x: 0, y: 4 })[0]).toMatchObject({ kind: "arc", radius: 4 });
    expect(session.previewAt({ x: 9, y: 0 })[0]).toMatchObject({ kind: "polyline" });
  });
});

describe("acceptsDistance applies only to steps that declare it", () => {
  it("a plain number is still an error for LINE and RECT", () => {
    const { session } = start();
    session.submitText("line");
    const line = session.submitText("100");
    expect(line.requests).toEqual([]);
    expect(line.messages[0]).toContain("点の座標を入力するか");
    session.cancel();
    session.submitText("rect");
    expect(session.submitText("100").messages[0]).toContain("点の座標を入力するか");
  });
});
