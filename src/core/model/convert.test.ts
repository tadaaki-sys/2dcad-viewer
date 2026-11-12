import { describe, expect, it } from "vitest";
import { parseDxfText } from "../../io/dxf/DxfParserAdapter";
import { computeAllEntityBounds, unionOfEntityBounds } from "../spatial/entityBounds";
import { factoryLayoutDxf, nestedBlocksDxf, smallDxf, unsupportedDxf } from "../../regression/fixtures";
import type { CadEntity, CadModel } from "../../types/cad";
import { cadModelFromDocument, documentFromCadModel } from "./convert";
import type { DeriveBounds } from "./convert";
import { createDocument } from "./document";

// 本番と同じ範囲の求め方(cad-viewの関数)を渡す。coreはcad-viewを読み込まないので、テストから注入する
const deriveBounds: DeriveBounds = (entities: readonly CadEntity[]) => {
  const entityBounds = computeAllEntityBounds(entities);
  return { entityBounds, bounds: unionOfEntityBounds(entityBounds) };
};

const roundTrip = (model: CadModel) => cadModelFromDocument(documentFromCadModel(model), deriveBounds);

describe("CadModel <-> CadDocument round trip", () => {
  const fixtures: Array<[string, () => string]> = [
    ["small", smallDxf],
    ["factory layout", factoryLayoutDxf],
    ["unsupported entities", unsupportedDxf],
    ["deeply nested blocks", () => nestedBlocksDxf(40)],
  ];

  for (const [name, makeDxf] of fixtures) {
    it(`restores exactly the same model: ${name}`, () => {
      const model = parseDxfText(makeDxf());
      const restored = roundTrip(model);

      expect(restored).toEqual(model);
      // 範囲は求め直した値だが、元と同じ内容になる
      expect(Array.from(restored.entityBounds)).toEqual(Array.from(model.entityBounds));
    });
  }

  it("reuses the entity and layer objects instead of copying them", () => {
    const model = parseDxfText(factoryLayoutDxf());
    const doc = documentFromCadModel(model);
    expect(doc.entities.length).toBe(model.entities.length);
    model.entities.forEach((entity, i) => expect(doc.entities[i]).toBe(entity));
    const restored = cadModelFromDocument(doc, deriveBounds);
    restored.entities.forEach((entity, i) => expect(entity).toBe(model.entities[i]));
    restored.layers.forEach((layer, i) => expect(layer).toBe(model.layers[i]));
  });

  it("keeps the import stats and the point style", () => {
    const model = parseDxfText(unsupportedDxf());
    const doc = documentFromCadModel(model);
    expect(doc.importStats).toEqual(model.stats);
    expect(doc.importStats?.unsupportedBreakdown).toEqual({ SOLID: 1 });

    const factory = parseDxfText(factoryLayoutDxf());
    expect(documentFromCadModel(factory).pointStyle).toEqual({ mode: 35, size: 20 });
  });

  it("does not let changes to a projected model reach the document", () => {
    const model = parseDxfText(factoryLayoutDxf());
    const doc = documentFromCadModel(model);
    const projected = cadModelFromDocument(doc, deriveBounds);
    const before = doc.entities.length;
    projected.entities.pop();
    projected.layers.pop();
    expect(doc.entities.length).toBe(before);
    expect(doc.layers.length).toBe(model.layers.length);
  });

  it("gives every imported entity a unique id that can be looked up", () => {
    const model = parseDxfText(factoryLayoutDxf());
    const doc = documentFromCadModel(model);
    expect(new Set(model.entities.map((e) => e.id)).size).toBe(model.entities.length);
    model.entities.forEach((entity, index) => expect(doc.indexById.get(entity.id)).toBe(index));
  });

  it("projects a new (non-imported) document with synthesized stats", () => {
    const doc = createDocument({ layers: [{ name: "0", color: "#ffffff", visible: true }], entities: [] });
    const model = cadModelFromDocument(doc, deriveBounds);
    expect(model.stats).toEqual({ totalEntityCount: 0, supportedEntityCount: 0, unsupportedEntityCount: 0, unsupportedBreakdown: {} });
    expect(model.bounds).toBeNull();
  });
});
