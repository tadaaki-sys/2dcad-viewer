// core/history のテスト用の補助(本番のコードからは読み込めない)
import type { CadEntity, CadLayer, CadLine } from "../../types/cad";
import { createDocument } from "../model/document";
import type { CadDocument } from "../model/document";

export const TEST_LAYERS: CadLayer[] = [
  { name: "0", color: "#ffffff", visible: true },
  { name: "MACHINE", color: "#00ff00", visible: true },
];

export function makeLine(id: string, x = 0, layer = "0"): CadLine {
  return { id, type: "LINE", layer, color: "#ffffff", start: { x, y: 0 }, end: { x: x + 10, y: 5 } };
}

/** ids の順に、線を並べたドキュメントを作る */
export function makeDocument(ids: readonly string[]): CadDocument {
  return createDocument({ layers: TEST_LAYERS, entities: ids.map((id, i) => makeLine(id, i * 20)) });
}

export function idsOf(document: CadDocument): string[] {
  return document.entities.map((e) => e.id);
}

/** 決まった順序の乱数(同じseedなら同じ列。失敗の再現のため) */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2つのドキュメントが、図形(同じオブジェクト)・索引・レイヤーまで一致するか */
export function expectSameDocument(actual: CadDocument, expected: CadDocument): string | null {
  if (actual.entities.length !== expected.entities.length) {
    return `図形の数が違います: ${actual.entities.length} / ${expected.entities.length}`;
  }
  for (let i = 0; i < actual.entities.length; i++) {
    if (actual.entities[i] !== expected.entities[i]) return `${i}番目の図形が違います`;
    if (actual.indexById.get(actual.entities[i].id) !== i) return `索引が合っていません: ${actual.entities[i].id}`;
  }
  if (actual.indexById.size !== actual.entities.length) return "索引の大きさが合っていません";
  if (actual.layers !== expected.layers) return "レイヤーが違います";
  return null;
}

export type { CadEntity };
