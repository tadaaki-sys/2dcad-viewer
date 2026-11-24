// 文字の内容の書き換え(TEXTEDIT。Phase 14): 置き換え・1回 = Undo 1段階・元データとの対応・読み取り専用
import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { IDENTITY_MATRIX } from "../../core/geometry/transform";
import { MAX_TEXT_LENGTH } from "../../core/text/textLayout";
import type { CadEntity, CadLayer, CadText, Point2D } from "../../types/cad";
import { createEditability } from "./editability";
import { DocumentSession } from "./documentSession";
import { editTextContent } from "./texting";

const LAYERS: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }, { name: "NOTE", color: "#ffff00", visible: true }];
const base = { layer: "0", color: "#ffffff" };
const pt = (x: number, y: number): Point2D => ({ x, y });

/** e0 取り込んだ1行の文字 / e1 取り込んだ複数行文字(NOTE レイヤー・枠つき・スタイルつき) / e2 ブロックの中身の文字(読み取り専用) / e3 線 / e4 取り込んだ(改行を含む)文字 */
function setup(extra: CadEntity[] = []) {
  const imported: CadEntity[] = [
    { ...base, id: "e0", type: "TEXT", position: pt(10, 20), text: "ABC", height: 5, rotation: 0.5, horizontalAlign: "left", verticalAlign: "baseline", widthFactor: 0.8 },
    {
      ...base,
      layer: "NOTE",
      color: "#ffff00",
      id: "e1",
      type: "TEXT",
      position: pt(100, 200),
      text: "line one\nline two",
      height: 8,
      rotation: 0,
      horizontalAlign: "left",
      verticalAlign: "top",
      boxWidth: 90,
      isMText: true,
      fontFamily: "serif",
      italic: true,
      styleName: "Note",
    },
    { ...base, id: "e2", type: "TEXT", position: pt(0, 0), text: "in a block", height: 5, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" },
    { ...base, id: "e3", type: "LINE", start: pt(0, 0), end: pt(10, 0) },
    { ...base, id: "e4", type: "TEXT", position: pt(300, 300), text: "a\nb", height: 5, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" },
  ];
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [...imported, ...extra] }));
  const editability = createEditability({
    importedIndexById: new Map(imported.map((entity, index) => [entity.id, index])),
    nested: Uint8Array.from([0, 0, 1, 0, 0]),
    parserIndex: Int32Array.from([0, 1, 2, 3, 4]),
  });
  return { session, editability };
}

const get = (session: DocumentSession, id: string) => session.document.entities.find((entity) => entity.id === id) as CadText;

describe("editTextContent", () => {
  it("replaces only the text: position, size, rotation, layer and the other attributes stay; one Undo step restores the same object", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const original = get(session, "e0");
    expect(editTextContent(session, editability, "e0", "XYZ")).toEqual({ ok: true, message: "文字を書き換えました" });
    const edited = get(session, "e0");
    expect(edited).toMatchObject({ id: "e0", text: "XYZ", position: pt(10, 20), height: 5, rotation: 0.5, widthFactor: 0.8, layer: "0", color: "#ffffff" });
    expect(session.document.entities.length).toBe(before.length);
    session.document.entities.forEach((entity, i) => {
      expect(entity.id).toBe(before[i].id);
      if (entity.id !== "e0") expect(entity).toBe(before[i]);
    });

    expect(session.undo().type).toBe("done");
    expect(get(session, "e0")).toBe(original);
    expect(session.canUndo).toBe(false);
    expect(session.redo().type).toBe("done");
    expect(get(session, "e0").text).toBe("XYZ");
  });

  it("keeps the MTEXT box, font, italic and style name; the text may have several lines", () => {
    const { session, editability } = setup();
    expect(editTextContent(session, editability, "e1", "new\nthree\nlines").ok).toBe(true);
    expect(get(session, "e1")).toMatchObject({ text: "new\nthree\nlines", boxWidth: 90, isMText: true, fontFamily: "serif", italic: true, styleName: "Note", layer: "NOTE", verticalAlign: "top" });
  });

  it("a one-line text cannot get line breaks (they become spaces); a text that already has line breaks may keep them", () => {
    const { session, editability } = setup();
    editTextContent(session, editability, "e0", "one\ntwo");
    expect(get(session, "e0").text).toBe("one two");
    editTextContent(session, editability, "e4", "x\ny\nz");
    expect(get(session, "e4").text).toBe("x\ny\nz");
  });

  it("the source record: imported text → its own record with the reshaped mark; a new text → none", () => {
    const { session, editability } = setup();
    editTextContent(session, editability, "e0", "XYZ");
    expect((get(session, "e0") as CadEntity).sourceRecord).toEqual({ id: "e0", matrix: IDENTITY_MATRIX, reshaped: true });
    const fresh = setup([{ ...base, id: "n1", type: "TEXT", position: pt(0, 500), text: "new", height: 5, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" }]);
    editTextContent(fresh.session, fresh.editability, "n1", "changed");
    expect(get(fresh.session, "n1").text).toBe("changed");
    expect((get(fresh.session, "n1") as CadEntity).sourceRecord).toBeUndefined();
  });

  it("refuses (and changes nothing): empty text, text that is too long, the same text, read-only text, a line, a missing figure", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    expect(editTextContent(session, editability, "e0", "")).toMatchObject({ ok: false, message: expect.stringContaining("空です") });
    expect(editTextContent(session, editability, "e0", "   ")).toMatchObject({ ok: false });
    expect(editTextContent(session, editability, "e0", "x".repeat(MAX_TEXT_LENGTH + 1))).toMatchObject({ ok: false, message: expect.stringContaining("長すぎます") });
    expect(editTextContent(session, editability, "e0", "ABC")).toMatchObject({ ok: false, message: expect.stringContaining("変わっていません") });
    expect(editTextContent(session, editability, "e2", "changed")).toEqual({ ok: false, message: "文字編集できません: ブロックの中身・寸法は、読み取り専用です" });
    expect(editTextContent(session, editability, "e3", "changed")).toMatchObject({ ok: false, message: expect.stringContaining("文字ではありません") });
    expect(editTextContent(session, editability, "zzz", "changed")).toMatchObject({ ok: false, message: expect.stringContaining("見つかりません") });
    expect(session.document.entities).toBe(before);
    expect(session.canUndo).toBe(false);
  });
});
