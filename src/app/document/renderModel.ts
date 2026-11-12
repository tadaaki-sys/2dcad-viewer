// ドキュメントから、画面の描画・選択・スナップが使う描画用モデル(CadModel)を作る。
import { cadModelFromDocument } from "../../core/model";
import type { CadDocument, DeriveBounds } from "../../core/model";
import { computeAllEntityBounds, unionOfEntityBounds } from "../../core/spatial/entityBounds";
import type { CadModel } from "../../types/cad";

/** 図形の範囲の求め方(本番も、テストも、同じものを使う) */
export const deriveBounds: DeriveBounds = (entities) => {
  const entityBounds = computeAllEntityBounds(entities);
  return { entityBounds, bounds: unionOfEntityBounds(entityBounds) };
};

export function renderModelFromDocument(document: CadDocument): CadModel {
  return cadModelFromDocument(document, deriveBounds);
}
