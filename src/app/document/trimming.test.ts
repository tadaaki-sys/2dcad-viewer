// TRIM・EXTEND の適用(Phase 11): 図形を探す・境界を集める・1クリック = Undo 1段階・元データとの対応・読み取り専用
import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { IDENTITY_MATRIX } from "../../core/geometry/transform";
import type { CadEntity, CadLayer, Point2D } from "../../types/cad";
import { createEditability } from "./editability";
import { trimOrExtendAt } from "./trimming";
import { DocumentSession } from "./documentSession";

const LAYERS: CadLayer[] = [
  { name: "0", color: "#ffffff", visible: true },
  { name: "HIDDEN", color: "#ffffff", visible: false },
];
const base = { layer: "0", color: "#ffffff" };

const line = (id: string, x0: number, y0: number, x1: number, y1: number, layer = "0"): CadEntity => ({ ...base, layer, id, type: "LINE", start: { x: x0, y: y0 }, end: { x: x1, y: y1 } });
const pt = (x: number, y: number): Point2D => ({ x, y });
const VISIBLE = new Set(["0"]);

/** e0 は横の線(0,0)-(100,0)。e1・e2 は縦の線 x=30・x=70。e3 は、ブロックの中身(読み取り専用)の横の線。e4 は円。e5 は文字 */
function setup(extra: CadEntity[] = []) {
  const imported: CadEntity[] = [
    line("e0", 0, 0, 100, 0),
    line("e1", 30, -50, 30, 50),
    line("e2", 70, -50, 70, 50),
    line("e3", 0, 200, 100, 200), // ブロックの中身
    { ...base, id: "e4", type: "CIRCLE", center: pt(50, 100), radius: 20 },
    { ...base, id: "e5", type: "TEXT", position: pt(500, 500), text: "A", height: 10, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" },
  ];
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [...imported, ...extra] }));
  const editability = createEditability({
    importedIndexById: new Map(imported.map((entity, index) => [entity.id, index])),
    nested: Uint8Array.from([0, 0, 0, 1, 0, 0]),
    parserIndex: Int32Array.from([0, 1, 2, 3, 4, 5]),
  });
  return { session, editability };
}

const get = (session: DocumentSession, id: string) => session.document.entities.find((entity) => entity.id === id);
const ends = (entity: CadEntity | undefined) => {
  const l = entity as unknown as { start: Point2D; end: Point2D };
  return [l.start.x, l.start.y, l.end.x, l.end.y];
};
const TOLERANCE = 2;

describe("TRIM", () => {
  it("between two boundaries: the clicked part goes; the line becomes two entities (the second is new, right above the first); ONE Undo step", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const result = trimOrExtendAt(session, editability, "trim", pt(50, 0.5), TOLERANCE, null, VISIBLE);
    expect(result).toEqual({ ok: true, message: "図形をトリムしました(2つの図形に分かれました)" });
    expect(ends(get(session, "e0"))).toEqual([0, 0, 30, 0]);
    const order = session.document.entities.map((entity) => entity.id);
    const second = session.document.entities[order.indexOf("e0") + 1];
    expect(second.id).toMatch(/^n\d+$/);
    expect(ends(second)).toEqual([70, 0, 100, 0]);
    expect(session.document.entities.length).toBe(before.length + 1);

    expect(session.undo().type).toBe("done");
    expect(session.document.entities.length).toBe(before.length);
    session.document.entities.forEach((entity, i) => expect(entity).toBe(before[i]));
    expect(session.canUndo).toBe(false);
  });

  it("the source record: both pieces point at the SAME original record and carry the reshaped mark; a new entity has none", () => {
    const { session, editability } = setup([line("n9", 0, 300, 100, 300), line("n10", 30, 250, 30, 350), line("n11", 70, 250, 70, 350)]);
    trimOrExtendAt(session, editability, "trim", pt(50, 0.5), TOLERANCE, ["e1", "e2"], VISIBLE);
    expect((get(session, "e0") as CadEntity).sourceRecord).toEqual({ id: "e0", matrix: IDENTITY_MATRIX, reshaped: true });
    const second = session.document.entities[session.document.entities.findIndex((e) => e.id === "e0") + 1];
    expect(second.sourceRecord).toEqual({ id: "e0", matrix: IDENTITY_MATRIX, reshaped: true });
    // 新しく描いた線は、元の記録が無い
    trimOrExtendAt(session, editability, "trim", pt(50, 300.5), TOLERANCE, ["n10", "n11"], VISIBLE);
    expect((get(session, "n9") as CadEntity).sourceRecord).toBeUndefined();
  });

  it("clicking outside the boundaries removes the end part only (one entity, replaced)", () => {
    const { session, editability } = setup();
    const result = trimOrExtendAt(session, editability, "trim", pt(10, 0), TOLERANCE, null, VISIBLE);
    expect(result).toEqual({ ok: true, message: "図形をトリムしました" });
    expect(ends(get(session, "e0"))).toEqual([30, 0, 100, 0]);
    expect(session.document.entities.length).toBe(6);
  });

  it("only the chosen boundaries count (edgeIds); the others are ignored", () => {
    const { session, editability } = setup();
    trimOrExtendAt(session, editability, "trim", pt(80, 0), TOLERANCE, ["e1"], VISIBLE);
    // 境界は x=30 だけ。右側(x=80)をクリックしたので、30 より右が消える
    expect(ends(get(session, "e0"))).toEqual([0, 0, 30, 0]);
  });

  it("boundaries on hidden layers are not used, and hidden entities are not picked", () => {
    const { session, editability } = setup([line("n0", 50, -50, 50, 50, "HIDDEN")]);
    const before = session.document;
    const hiddenBoundary = trimOrExtendAt(session, editability, "trim", pt(80, 0), TOLERANCE, ["n0"], VISIBLE);
    expect(hiddenBoundary.ok).toBe(false);
    expect(session.document).toBe(before);
    const hiddenTarget = trimOrExtendAt(session, editability, "trim", pt(50, 49), TOLERANCE, null, VISIBLE);
    expect(hiddenTarget.ok).toBe(false); // (50,49) には、非表示の線しかない
  });

  it("the whole entity goes when the clicked part is all of it (the entity is removed)", () => {
    const { session, editability } = setup([line("n0", 0, 500, 10, 500), line("n1", 0, 490, 0, 510), line("n2", 10, 490, 10, 510)]);
    const result = trimOrExtendAt(session, editability, "trim", pt(5, 500), TOLERANCE, ["n1", "n2"], VISIBLE);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("削除");
    expect(get(session, "n0")).toBeUndefined();
  });

  it("a circle becomes an arc (same id, type changed); the source record is marked", () => {
    const { session, editability } = setup();
    // 円 (50,100) r20 を、横の線 y=100 の代わりに、縦の線 x=60 で切る(交点が2つ)
    const withCut = setup([line("n0", 60, 50, 60, 150)]);
    const result = trimOrExtendAt(withCut.session, withCut.editability, "trim", pt(70, 100), TOLERANCE, ["n0"], VISIBLE);
    expect(result.ok).toBe(true);
    expect(get(withCut.session, "e4")).toMatchObject({ type: "ARC", id: "e4", radius: 20, sourceRecord: { id: "e4", reshaped: true } });
    void session;
    void editability;
  });

  it("refuses with a reason: nothing at the click, read-only entities, unsupported types, no boundary, a boundary that does not cross", () => {
    const { session, editability } = setup();
    const before = session.document;
    expect(trimOrExtendAt(session, editability, "trim", pt(300, 300), TOLERANCE, null, VISIBLE).message).toContain("図形がありません");
    const readOnly = trimOrExtendAt(session, editability, "trim", pt(50, 200), TOLERANCE, null, VISIBLE);
    expect(readOnly.ok).toBe(false);
    expect(readOnly.message).toContain("読み取り専用");
    const text = trimOrExtendAt(session, editability, "trim", pt(500, 500), TOLERANCE, null, VISIBLE);
    expect(text.ok).toBe(false);
    expect(text.message).toContain("TEXT");
    expect(trimOrExtendAt(session, editability, "trim", pt(50, 0), TOLERANCE, [], VISIBLE).message).toContain("境界がありません");
    // e0 と交わらない境界(円 e4 だけ)
    const noCross = trimOrExtendAt(session, editability, "trim", pt(50, 0), TOLERANCE, ["e4"], VISIBLE);
    expect(noCross.ok).toBe(false);
    expect(noCross.message).toContain("交わる境界がありません");
    expect(session.document).toBe(before);
    expect(trimOrExtendAt(session, editability, "trim", pt(Number.NaN, 0), TOLERANCE, null, VISIBLE).ok).toBe(false);
    expect(trimOrExtendAt(session, editability, "trim", pt(50, 0), 0, null, VISIBLE).ok).toBe(false);
  });

  it("a read-only entity on top of an editable one does not block the editable one", () => {
    // ブロックの中身の線 e3 と同じ位置に、新しく描いた線 n0。クリックは、編集できる n0 を対象にする
    const { session, editability } = setup([line("n0", 0, 200, 100, 200), line("n1", 40, 150, 40, 250)]);
    const result = trimOrExtendAt(session, editability, "trim", pt(80, 200), TOLERANCE, ["n1"], VISIBLE);
    expect(result.ok).toBe(true);
    expect(ends(get(session, "n0"))).toEqual([0, 200, 40, 200]);
    expect(ends(get(session, "e3"))).toEqual([0, 200, 100, 200]); // ブロックの中身は、そのまま
  });

  it("consecutive clicks are separate Undo steps, each acting on the shape left by the one before", () => {
    const { session, editability } = setup();
    trimOrExtendAt(session, editability, "trim", pt(10, 0), TOLERANCE, null, VISIBLE); // 0..30 を切る → 30..100
    trimOrExtendAt(session, editability, "trim", pt(90, 0), TOLERANCE, null, VISIBLE); // 70..100 を切る → 30..70
    expect(ends(get(session, "e0"))).toEqual([30, 0, 70, 0]);
    session.undo();
    expect(ends(get(session, "e0"))).toEqual([30, 0, 100, 0]);
    session.undo();
    expect(ends(get(session, "e0"))).toEqual([0, 0, 100, 0]);
    expect(session.canUndo).toBe(false);
  });
});

describe("EXTEND", () => {
  it("extends the end nearer to the click to the nearest boundary; one Undo step", () => {
    const { session, editability } = setup([line("n0", 0, 400, 20, 400), line("n1", 50, 350, 50, 450), line("n2", 90, 350, 90, 450)]);
    const before = session.document.entities;
    const result = trimOrExtendAt(session, editability, "extend", pt(18, 400), TOLERANCE, ["n1", "n2"], VISIBLE);
    expect(result).toEqual({ ok: true, message: "図形を延長しました" });
    expect(ends(get(session, "n0"))).toEqual([0, 400, 50, 400]);
    expect((get(session, "n0") as CadEntity).sourceRecord).toBeUndefined(); // 新しい図形
    session.undo();
    session.document.entities.forEach((entity, i) => expect(entity).toBe(before[i]));
  });

  it("an imported line gets the reshaped mark; a missing boundary is refused", () => {
    const { session, editability } = setup();
    // e0 (0,0)-(100,0) の右端を、縦の線 x=150 まで
    const withBoundary = setup([line("n0", 150, -50, 150, 50)]);
    const ok = trimOrExtendAt(withBoundary.session, withBoundary.editability, "extend", pt(95, 0), TOLERANCE, ["n0"], VISIBLE);
    expect(ok.ok).toBe(true);
    expect(ends(get(withBoundary.session, "e0"))).toEqual([0, 0, 150, 0]);
    expect((get(withBoundary.session, "e0") as CadEntity).sourceRecord).toEqual({ id: "e0", matrix: IDENTITY_MATRIX, reshaped: true });
    const before = session.document;
    const none = trimOrExtendAt(session, editability, "extend", pt(95, 0), TOLERANCE, ["e1", "e2"], VISIBLE); // 境界は、左側にしかない
    expect(none.ok).toBe(false);
    expect(none.message).toContain("境界がありません");
    expect(session.document).toBe(before);
  });

  it("a circle cannot be extended", () => {
    const { session, editability } = setup();
    const result = trimOrExtendAt(session, editability, "extend", pt(70, 100), TOLERANCE, null, VISIBLE);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("延長できません");
  });
});

describe("a large drawing", () => {
  it("trims one line among 100,000 entities in one step", () => {
    const many: CadEntity[] = Array.from({ length: 100_000 }, (_, i) => line(`n${i}`, 1000 + (i % 300), 1000 + Math.floor(i / 300), 1001 + (i % 300), 1001 + Math.floor(i / 300)));
    const { session, editability } = setup(many);
    const started = performance.now();
    const result = trimOrExtendAt(session, editability, "trim", pt(80, 0), TOLERANCE, null, VISIBLE);
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(true);
    expect(ends(get(session, "e0"))).toEqual([0, 0, 70, 0]);
    expect(elapsed).toBeLessThan(5000); // 速いPCでは、数十ミリ秒
  });
});

describe("Codex review fixes (Phase 11)", () => {
  it("a boundary that stops a hair short of the target (within the intersection tolerance) is still found by the pre-filter", () => {
    // 境界の端 (50, 5e-10) は、対象の線 y=0 から、0.0000000005 mm だけ離れている。core の許容(1e-9 mm)では、交点
    const { session, editability } = setup([line("n0", 50, 5e-10, 50, 10)]);
    const result = trimOrExtendAt(session, editability, "trim", pt(80, 0), TOLERANCE, ["n0"], VISIBLE);
    expect(result.ok).toBe(true);
    expect(ends(get(session, "e0"))).toEqual([0, 0, 50, 0]);
  });

  it("extending also finds a boundary whose end is a hair away from the extended line", () => {
    const { session, editability } = setup([line("n0", 150, 5e-10, 150, 50)]);
    const result = trimOrExtendAt(session, editability, "extend", pt(95, 0), TOLERANCE, ["n0"], VISIBLE);
    expect(result.ok).toBe(true);
    expect(ends(get(session, "e0"))).toEqual([0, 0, 150, 0]);
  });
});
