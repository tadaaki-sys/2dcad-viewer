// コマンドラインに打ち込んだ座標(文字)を読み取る。画面にも描画にも依存しない純粋な処理。
//
//   1000,500    絶対座標(原点から)
//   @500,0      相対座標(直前の点から)
//   @1000<30    相対の極座標(直前の点から、長さと角度)
//   1000<30     極座標(原点から、長さと角度)
//   500         長さだけ(距離を尋ねられたとき用)
//
// 角度は「度」で、+X方向を0、反時計回りを正とする。全角の文字(，＠＜数字など)と空白も受け付ける。
import type { Point2D } from "../../types/cad";

export type CoordinateParseResult =
  | { ok: true; kind: "point"; point: Point2D }
  | { ok: true; kind: "distance"; value: number }
  | { ok: false; error: string };

// 指数表記(1e3)は受け付けない。「Infinity」「NaN」のような文字も通らない
const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * 全角を半角にそろえ、前後と、区切り(, < @)の前後の空白を取り除く(「1000 , 500」「１０００，５００」を同じに扱う)。
 * 数字の途中の空白(「1 2」)は取り除かない(「12」と誤って読まないよう、読み取りでエラーにする)。
 * マイナスの代わりに使われやすい「−」(U+2212)と「ー」(長音)も、「-」として扱う。
 */
export function normalizeCoordinateText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[−ー]/g, "-")
    .trim()
    .replace(/\s*([,<@])\s*/g, "$1");
}

function parseNumber(text: string): number | null {
  if (!NUMBER_PATTERN.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** 計算した結果の点が有限か確かめる(入力の数値が有限でも、足し算や掛け算で溢れることがある) */
function finitePoint(x: number, y: number): CoordinateParseResult {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: "座標の値が大きすぎて計算できません" };
  }
  return { ok: true, kind: "point", point: { x, y } };
}

/**
 * 座標の文字を読み取る。
 * @param basePoint 直前の点。相対座標(@)で使う。無ければ、相対座標はエラーになる
 */
export function parseCoordinateInput(text: string, basePoint: Point2D | null): CoordinateParseResult {
  let body = normalizeCoordinateText(text);
  if (body === "") return { ok: false, error: "座標が入力されていません" };
  if (/\s/.test(body)) return { ok: false, error: "数値の途中に空白があります" };

  const isRelative = body.startsWith("@");
  if (isRelative) {
    body = body.slice(1);
    if (body === "") return { ok: false, error: "「@」の後に座標が必要です(例: @500,0)" };
    if (basePoint === null) return { ok: false, error: "相対座標(@)は、先に1点を指示してから使えます" };
  }
  const origin: Point2D = isRelative && basePoint !== null ? basePoint : { x: 0, y: 0 };

  if (body.includes(",") && body.includes("<")) {
    return { ok: false, error: "「,」と「<」は一緒に使えません" };
  }

  if (body.includes(",")) {
    const parts = body.split(",");
    if (parts.length !== 2) return { ok: false, error: "座標は「X,Y」の形で入力してください(例: 1000,500)" };
    const x = parseNumber(parts[0]);
    const y = parseNumber(parts[1]);
    if (x === null || y === null) return { ok: false, error: "座標は数値で入力してください(例: 1000,500)" };
    return finitePoint(origin.x + x, origin.y + y);
  }

  if (body.includes("<")) {
    const parts = body.split("<");
    if (parts.length !== 2) return { ok: false, error: "極座標は「長さ<角度」の形で入力してください(例: 1000<30)" };
    const length = parseNumber(parts[0]);
    const angleDeg = parseNumber(parts[1]);
    if (length === null || angleDeg === null) return { ok: false, error: "極座標は数値で入力してください(例: 1000<30)" };
    // 角度は先に360度の範囲へ収める(非常に大きな角度で、ラジアンへの変換が溢れないように)
    const angle = ((angleDeg % 360) * Math.PI) / 180;
    return finitePoint(origin.x + length * Math.cos(angle), origin.y + length * Math.sin(angle));
  }

  // 「@500」のように、@の後が長さだけの形は意味が決まらないので受け付けない
  if (isRelative) return { ok: false, error: "「@」の後は、「X,Y」または「長さ<角度」で入力してください" };

  const value = parseNumber(body);
  if (value === null) return { ok: false, error: `座標として読み取れません: ${text.trim()}` };
  return { ok: true, kind: "distance", value };
}
