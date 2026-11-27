// 図形を「編集してよいか」の判断。React にも、ファイル形式(io/)にも依存しない。
// 取り込んだ図形の分類(ブロックの中身・寸法は読み取り専用、など)は io/ にあるので、画面の側(App.tsx)が、その分類を
// このファイルの型(EditabilitySource)に直して渡す(app/ は io/ を読めないため)。
import { parseNewEntityCounter } from "../../core/model";
import type { CadDocument, EntityId } from "../../core/model";

/** 取り込んだ図形の分類。画面の側が、元データ(io/dxf/source.ts)から作る */
export type EditabilitySource = {
  /** 取り込んだ図形のID → 取り込んだときの並びでの位置(分類の配列の添字) */
  importedIndexById: ReadonlyMap<EntityId, number>;
  /** 1ならブロック(INSERT・寸法)の展開で作られた図形(読み取り専用)。0なら最上位の図形 */
  nested: Uint8Array;
  /** 元データの記録との対応(-1なら、対応する記録が無い) */
  parserIndex: Int32Array;
};

export type Editability = {
  /** 編集してよいか */
  isEditable(id: EntityId): boolean;
  /** 編集できないときの理由(編集できるなら null) */
  reasonFor(id: EntityId): string | null;
};

export const READ_ONLY_REASON = "ブロックの中身・寸法は、読み取り専用です";
export const NOT_MAPPED_REASON = "この図面は、元データと対応づけられなかったため、取り込んだ図形は編集できません";
export const UNKNOWN_ENTITY_REASON = "図形が見つかりません";

/** 新しく描いた図形(ID が n<番号>)か */
export function isNewEntityId(id: EntityId): boolean {
  return parseNewEntityCounter(id) !== null;
}

/**
 * 編集可否の判断を作る。source が null(元データが無い・元データとの対応づけに失敗した図面)のときは、
 * 取り込んだ図形は、すべて編集できない(新しく描いた図形だけ、編集できる)。
 */
export function createEditability(source: EditabilitySource | null): Editability {
  const reasonFor = (id: EntityId): string | null => {
    if (isNewEntityId(id)) return null;
    if (source === null) return NOT_MAPPED_REASON;
    const index = source.importedIndexById.get(id);
    if (index === undefined) return UNKNOWN_ENTITY_REASON;
    // 分類の配列と食い違っているとき(範囲外など)は、編集できる側に倒さず、編集できない側に倒す
    if (!Number.isInteger(index) || index < 0 || index >= source.nested.length || index >= source.parserIndex.length) return NOT_MAPPED_REASON;
    if (source.nested[index] !== 0) return READ_ONLY_REASON;
    if (!(source.parserIndex[index] >= 0)) return NOT_MAPPED_REASON;
    return null;
  };
  return { isEditable: (id) => reasonFor(id) === null, reasonFor };
}

export type EditTargets = {
  /** 編集できる図形のID(渡された順) */
  editable: EntityId[];
  /** 編集できないために除いた数 */
  skipped: number;
  /** 除いた図形の、最初の理由(無ければ null) */
  reason: string | null;
};

/** 選択などのIDの一覧から、編集できるものだけを取り出す(重複は除く) */
export function resolveEditTargets(editability: Editability, ids: Iterable<EntityId>): EditTargets {
  const editable: EntityId[] = [];
  let skipped = 0;
  let reason: string | null = null;
  for (const id of new Set(ids)) {
    const why = editability.reasonFor(id);
    if (why === null) editable.push(id);
    else {
      skipped++;
      reason ??= why;
    }
  }
  return { editable, skipped, reason };
}

/**
 * ロックされたレイヤー(Phase 19)の図形も、編集できないものとして扱う判断を作る。図形の取り込みの分類(base)の判断を先に使い、
 * それで編集できる図形でも、そのレイヤーがロックされていれば、理由を返す。getDocument は、いまの図面(無ければ null)。
 * 編集のコマンド・グリップ・プロパティ・描画順の、どの入口も、この判断を通すので、ロックが漏れなく効く。
 */
export function withLockedLayers(base: Editability, getDocument: () => CadDocument | null): Editability {
  const reasonFor = (id: EntityId): string | null => {
    const reason = base.reasonFor(id);
    if (reason !== null) return reason;
    const document = getDocument();
    if (document === null) return null;
    const index = document.indexById.get(id);
    if (index === undefined) return null;
    const layerName = document.entities[index].layer;
    const layer = document.layers[document.layerIndexByName.get(layerName) ?? -1];
    return layer !== undefined && layer.locked === true ? `レイヤー「${layerName}」はロックされています` : null;
  };
  return { isEditable: (id) => reasonFor(id) === null, reasonFor };
}