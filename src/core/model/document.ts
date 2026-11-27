// ドキュメントモデル(編集の正本)。React・DOM・DXFパーサーに依存しない(src/core/boundary.test.ts で確認している)。
// Phase 1a では、読み取りの関数だけを持つ。変更(追加・削除・移動)は、コマンドとUndoの Phase で足す。
import type { CadEntity, CadGroup, CadLayer, CadLineType, CadModelStats, CadPointStyle } from "../../types/cad";
import { buildLineTypeTable } from "../style/lineTypes";
import { newEntityId } from "./ids";
import type { EntityId } from "./ids";

/** 内部のスキーマ番号。0は「まだ保存形式に使わない内部用」の意味。ファイルに保存する段階(Phase 21)で1から始める */
export const DOCUMENT_SCHEMA_VERSION = 0;

export const DEFAULT_POINT_STYLE: CadPointStyle = { mode: 0, size: 0 };

export type CadDocument = {
  readonly schemaVersion: number;
  /** 単位はmm固定 */
  readonly units: "mm";
  readonly layers: readonly CadLayer[];
  /** 図形の一覧。配列の順が描画順(前にあるほど下に描く) */
  readonly entities: readonly CadEntity[];
  /** 図形ID → entities内の位置。ドキュメント作成時に1度だけ作り、読み取り専用で共有する */
  readonly indexById: ReadonlyMap<EntityId, number>;
  readonly layerIndexByName: ReadonlyMap<string, number>;
  /** 線種表(実線・取り込んだ線種・標準の線種)。Phase 17 では、図面の中では変えない */
  readonly lineTypes: readonly CadLineType[];
  /** 全体の線種尺度($LTSCALE)。破線の長さは、線種の要素にこの値と図形ごとの尺度を掛けたもの */
  readonly ltScale: number;
  /** グループ表(Phase 19)。どのグループの ID も、図面にある図形を指す(適用のたびに確かめる) */
  readonly groups: readonly CadGroup[];
  readonly pointStyle: CadPointStyle;
  /** 取り込み時の統計(未対応の図形の件数など)。新規に作ったドキュメントでは null */
  readonly importStats: CadModelStats | null;
  /** 新しい図形のIDを払い出すための番号 */
  readonly nextNewId: number;
};

export type CreateDocumentInput = {
  layers: readonly CadLayer[];
  entities: readonly CadEntity[];
  /** 取り込んだ図面の線種(標準の線種と合わせて、線種表にする)。省略すると標準の線種だけ */
  lineTypes?: readonly CadLineType[];
  /** 全体の線種尺度。省略・不正な値は 1 */
  ltScale?: number;
  /** グループ表。省略すると、グループなし */
  groups?: readonly CadGroup[];
  pointStyle?: CadPointStyle;
  importStats?: CadModelStats | null;
};

/** ドキュメントを作る。図形IDやレイヤー名が重複していたら、データ破損を避けるためエラーにする */
export function createDocument(input: CreateDocumentInput): CadDocument {
  const indexById = new Map<EntityId, number>();
  input.entities.forEach((entity, index) => {
    if (indexById.has(entity.id)) throw new Error(`図形IDが重複しています: ${entity.id}`);
    indexById.set(entity.id, index);
  });

  const layerIndexByName = new Map<string, number>();
  input.layers.forEach((layer, index) => {
    if (layerIndexByName.has(layer.name)) throw new Error(`レイヤー名が重複しています: ${layer.name}`);
    layerIndexByName.set(layer.name, index);
  });

  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    units: "mm",
    layers: input.layers,
    entities: input.entities,
    indexById,
    layerIndexByName,
    lineTypes: buildLineTypeTable(input.lineTypes),
    ltScale: typeof input.ltScale === "number" && input.ltScale > 0 && Number.isFinite(input.ltScale) ? input.ltScale : 1,
    groups: input.groups ?? [],
    pointStyle: input.pointStyle ?? DEFAULT_POINT_STYLE,
    importStats: input.importStats ?? null,
    nextNewId: 0,
  };
}

export function entityCount(document: CadDocument): number {
  return document.entities.length;
}

export function hasEntity(document: CadDocument, id: EntityId): boolean {
  return document.indexById.has(id);
}

/** IDから図形を引く。無ければundefined */
export function getEntity(document: CadDocument, id: EntityId): CadEntity | undefined {
  const index = document.indexById.get(id);
  return index === undefined ? undefined : document.entities[index];
}

/** 図形の描画順での位置。無ければ-1 */
export function indexOfEntity(document: CadDocument, id: EntityId): number {
  return document.indexById.get(id) ?? -1;
}

export function getLayer(document: CadDocument, name: string): CadLayer | undefined {
  const index = document.layerIndexByName.get(name);
  return index === undefined ? undefined : document.layers[index];
}

/**
 * 新しい図形のIDを払い出す。戻り値の document は、払い出し番号を進めた新しいドキュメント(図形の配列などは共有する)。
 * 取り込んだ図形のIDと重ならないよう、使われているIDは飛ばす。
 */
export function allocateEntityId(document: CadDocument): { id: EntityId; document: CadDocument } {
  let counter = document.nextNewId;
  let id = newEntityId(counter);
  while (document.indexById.has(id)) {
    counter++;
    id = newEntityId(counter);
  }
  return { id, document: { ...document, nextNewId: counter + 1 } };
}
