// 入力された文字(TEXT・MTEXT の内容)の確認。画面にもファイル形式にも依存しない。
import { MAX_TEXT_LENGTH } from "./textLayout";

export type TextInputCheck = { ok: true; text: string } | { ok: false; message: string };

/** 文字として使えない制御文字(改行 \n とタブは、別に扱う) */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** 見えない文字(空白・ソフトハイフン・ゼロ幅・書式の制御・BOM)。これだけの文字は、空とみなす */
const INVISIBLE_CHARACTERS = /[\s\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

/**
 * 入力された文字を確かめる。改行は \n にそろえ、タブは空白にし、複数行でなければ、改行は空白にする。
 * 制御文字を含む・空(空白や見えない文字だけ)・長すぎるときは、理由つきで断る。
 */
export function checkTextInput(text: string, multiline: boolean): TextInputCheck {
  const unified = text.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  if (CONTROL_CHARACTERS.test(unified)) return { ok: false, message: "文字に、使えない制御文字が含まれています(見えない文字を取り除いて、入力し直してください)" };
  const value = multiline ? unified : unified.replace(/\n/g, " ");
  if (value.replace(INVISIBLE_CHARACTERS, "") === "") return { ok: false, message: "文字が空です(空白・見えない文字だけです)。文字を入力してください(Esc で取り消し)" };
  if (value.length > MAX_TEXT_LENGTH) return { ok: false, message: `文字が長すぎます(${MAX_TEXT_LENGTH} 文字まで)` };
  return { ok: true, text: value };
}
