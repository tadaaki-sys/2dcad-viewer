/**
 * 描画用モデル(CadModel)の各図形が、dxf-parserの図形一覧(raw.entities)のどれから来たかの対応表。
 * 図形の並び(CadModel.entities)と同じ順で、同じ長さ。図形のデータ自体は変えず、別に持つ。
 */
export type EntityOrigin = {
  /** raw.entities内の位置。分からなければ-1 */
  parserIndex: Int32Array;
  /** 1ならブロック(INSERT・寸法)の展開で作られた図形(読み取り専用)。0なら最上位の図形(編集できる) */
  nested: Uint8Array;
};
