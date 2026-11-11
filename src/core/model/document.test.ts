import { describe, expect, it } from "vitest";
import type { CadEntity, CadLayer } from "../../types/cad";
import { allocateEntityId, createDocument, entityCount, getEntity, getLayer, hasEntity, indexOfEntity } from "./document";

const line = (id: string, layer = "0"): CadEntity => ({
  id,
  type: "LINE",
  layer,
  color: "#ffffff",
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
});

const layers: CadLayer[] = [
  { name: "0", color: "#ffffff", visible: true },
  { name: "WALL", color: "#ff0000", visible: false },
];

describe("createDocument", () => {
  it("keeps the entity order (the draw order) and the layers", () => {
    const entities = [line("e2"), line("e0"), line("e1")];
    const doc = createDocument({ layers, entities });
    expect(doc.entities.map((e) => e.id)).toEqual(["e2", "e0", "e1"]);
    expect(doc.layers).toEqual(layers);
    expect(doc.units).toBe("mm");
    expect(entityCount(doc)).toBe(3);
  });

  it("uses a dot as the default point style and no import stats for a new document", () => {
    const doc = createDocument({ layers: [], entities: [] });
    expect(doc.pointStyle).toEqual({ mode: 0, size: 0 });
    expect(doc.importStats).toBeNull();
  });

  it("rejects duplicated entity ids and duplicated layer names instead of corrupting the document", () => {
    expect(() => createDocument({ layers, entities: [line("e0"), line("e0")] })).toThrow("図形IDが重複しています: e0");
    expect(() => createDocument({ layers: [layers[0], layers[0]], entities: [] })).toThrow("レイヤー名が重複しています: 0");
  });
});

describe("lookups", () => {
  const doc = createDocument({ layers, entities: [line("e5"), line("e9", "WALL")] });

  it("finds an entity by id and reports its position", () => {
    expect(getEntity(doc, "e9")?.layer).toBe("WALL");
    expect(indexOfEntity(doc, "e5")).toBe(0);
    expect(indexOfEntity(doc, "e9")).toBe(1);
    expect(hasEntity(doc, "e5")).toBe(true);
  });

  it("returns undefined / -1 / false for unknown ids", () => {
    expect(getEntity(doc, "zzz")).toBeUndefined();
    expect(indexOfEntity(doc, "zzz")).toBe(-1);
    expect(hasEntity(doc, "zzz")).toBe(false);
  });

  it("finds layers by name", () => {
    expect(getLayer(doc, "WALL")?.color).toBe("#ff0000");
    expect(getLayer(doc, "NOPE")).toBeUndefined();
  });

  it("returns the very same entity object (no copy)", () => {
    const entity = line("e0");
    const single = createDocument({ layers, entities: [entity] });
    expect(getEntity(single, "e0")).toBe(entity);
  });
});

describe("allocateEntityId", () => {
  it("hands out unique ids that never collide with the imported ones", () => {
    let doc = createDocument({ layers, entities: [line("e0"), line("e1")] });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const allocated = allocateEntityId(doc);
      ids.push(allocated.id);
      doc = allocated.document;
    }
    expect(ids).toEqual(["n0", "n1", "n2", "n3", "n4"]);
    expect(new Set(ids).size).toBe(5);
    expect(ids.some((id) => hasEntity(doc, id))).toBe(false);
  });

  it("skips ids that are already used by existing entities", () => {
    const doc = createDocument({ layers, entities: [line("n0"), line("n1")] });
    expect(allocateEntityId(doc).id).toBe("n2");
  });

  it("does not change the original document (pure) and shares the entity storage", () => {
    const doc = createDocument({ layers, entities: [line("e0")] });
    const { document: next } = allocateEntityId(doc);
    expect(doc.nextNewId).toBe(0);
    expect(next.nextNewId).toBe(1);
    expect(next.entities).toBe(doc.entities);
    expect(next.indexById).toBe(doc.indexById);
  });
});
