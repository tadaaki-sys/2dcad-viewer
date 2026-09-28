const UNICODE_ESCAPE_PATTERN = /\\U\+([0-9A-Fa-f]{4})/g;
const FONT_CODE_PATTERN = /\\[fF][^;]*;/g;
const NUMERIC_PARAM_CODE_PATTERN = /\\[HWQTAC][^;]*;/gi;
const TOGGLE_CODE_PATTERN = /\\[LlOoKk]/g;

/**
 * MTEXTのインライン書式コード(フォント/高さ/色などの制御コード、改行\P、グループ化の中括弧)や
 * 旧形式の特殊記号コード(%%d等)を取り除き、表示用のプレーンテキストに変換する。
 * ビューアとしては書式の再現ではなく可読性を優先する簡易実装。
 */
export function stripMtextFormatting(raw: string): string {
  return raw
    .replace(/\\P/g, "\n")
    .replace(/\\~/g, " ")
    .replace(UNICODE_ESCAPE_PATTERN, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(FONT_CODE_PATTERN, "")
    .replace(NUMERIC_PARAM_CODE_PATTERN, "")
    .replace(TOGGLE_CODE_PATTERN, "")
    .replace(/[{}]/g, "")
    .replace(/%%d/gi, "°")
    .replace(/%%p/gi, "±")
    .replace(/%%c/gi, "⌀")
    .replace(/\\\\/g, "\\");
}
