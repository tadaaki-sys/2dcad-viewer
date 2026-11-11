// 既存の描画用モデル(CadModel)とドキュメントモデルの間の変換。
// Phase 1a ではどちらもアプリにはつながず、往復しても同じになること(テスト)だけを保証する。
import type { CadBounds, CadEntity, CadModel } from "../../types/cad";
import { createDocument } from "./document";
import type { CadDocument } from "./document";

/**
 * 図形の範囲(バウンディングボックス)を求める関数。`cad-view/spatial/entityBounds` の
 * computeAllEntityBounds と unionOfEntityBounds を組み合わせたものを、呼び出し側が渡す。
 * (coreがcad-viewに依存しないよう、関数を引数で受け取る)
 */
export type DeriveBounds = (entities: readonly CadEntity[]) => { entityBounds: Float64Array; bounds: CadBounds | null };

/** 描画用モデルからドキュメントを作る。図形・レイヤーのオブジェクトはコピーせず、そのまま使う */
export function documentFromCadModel(model: CadModel): CadDocument {
  return createDocument({
    layers: model.layers,
    entities: model.entities,
    pointStyle: model.pointStyle,
    importStats: model.stats,
  });
}

/** ドキュメントから描画用モデルを作る(投影)。範囲は図形から求め直す */
export function cadModelFromDocument(document: CadDocument, deriveBounds: DeriveBounds): CadModel {
  const { entityBounds, bounds } = deriveBounds(document.entities);
  const count = document.entities.length;
  return {
    // CadModelは変更可能な配列型なので、ドキュメント側の配列を直接渡さずコピーする(参照の共有で内部状態が書き換わるのを防ぐ)
    entities: document.entities.slice(),
    entityBounds,
    layers: document.layers.slice(),
    pointStyle: document.pointStyle,
    bounds,
    stats: document.importStats ?? {
      totalEntityCount: count,
      supportedEntityCount: count,
      unsupportedEntityCount: 0,
      unsupportedBreakdown: {},
    },
  };
}
