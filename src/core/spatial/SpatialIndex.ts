import type { CadBounds, CadModel } from "../../types/cad";
import { SpatialGrid } from "./SpatialGrid";

/** 図形ごとのバウンディングボックスと、それを引く格子。選択・スナップ・描画で共有する */
export type SpatialIndex = {
  entityBounds: Float64Array;
  grid: SpatialGrid;
  worldBounds: CadBounds | null;
};

export function buildSpatialIndex(model: Pick<CadModel, "entityBounds" | "bounds">): SpatialIndex {
  return {
    entityBounds: model.entityBounds,
    grid: new SpatialGrid(model.entityBounds, model.bounds),
    worldBounds: model.bounds,
  };
}
