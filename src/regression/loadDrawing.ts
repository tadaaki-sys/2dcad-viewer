// 実図面の回帰テスト用: ファイルを読み込み、本番のワーカーと同じ手順で内部モデルまで変換する。
// 実図面と基準値は regression-local/ (git管理外)に置く。ここにはお客様の情報を入れない。
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import DxfParser from "dxf-parser";
import { convertToCadModel } from "../dxf/DxfParserAdapter";
import { decodeDxfBuffer } from "../dxf/dxfEncoding";
import { detectDwgVersion } from "../dxf/dwgFormat";
import { convertDwgToDxfBuffer } from "../dxf/dwgToDxf";
import { extractLayerStyles } from "../dxf/layerStyles";
import type { CadModel } from "../types/cad";

export const REGRESSION_DIR = path.resolve("regression-local");
export const REAL_ENABLED = process.env.CAD_REGRESSION_REAL === "1";
export const UPDATE_BASELINE = process.env.CAD_REGRESSION_UPDATE === "1";

export type ManifestEntry = { name: string; path: string };

/** regression-local/manifest.json の drawings を読む。無ければ空(テストはスキップされる) */
export function readManifest(): ManifestEntry[] {
  const file = path.join(REGRESSION_DIR, "manifest.json");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { drawings?: ManifestEntry[] };
  return (parsed.drawings ?? []).filter((entry) => fs.existsSync(entry.path));
}

export type LoadedDrawing = {
  model: CadModel;
  isDwg: boolean;
  timings: { dwgConvertMs: number; parseMs: number; convertMs: number };
};

export async function loadDrawing(file: string): Promise<LoadedDrawing> {
  const buffer = fs.readFileSync(file);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  let dwgConvertMs = 0;
  const isDwg = detectDwgVersion(arrayBuffer) !== null;
  let text: string;
  if (isDwg) {
    const started = performance.now();
    text = decodeDxfBuffer(await convertDwgToDxfBuffer(arrayBuffer));
    dwgConvertMs = performance.now() - started;
  } else {
    text = decodeDxfBuffer(arrayBuffer);
  }

  const parseStarted = performance.now();
  const raw = new DxfParser().parseSync(text);
  if (!raw) throw new Error(`DXFの解析結果が空です: ${file}`);
  const parseMs = performance.now() - parseStarted;

  const convertStarted = performance.now();
  const model = convertToCadModel(raw, { layerStyles: extractLayerStyles(text), ignoreLayerOffFlag: isDwg });
  const convertMs = performance.now() - convertStarted;

  return { model, isDwg, timings: { dwgConvertMs, parseMs, convertMs } };
}

const round3 = (n: number) => Math.round(n * 1e3) / 1e3;

/** 図形の座標・属性を丸めて連結し、ハッシュにする(idは連番なので除く)。図形が1つでも変われば値が変わる */
export function geometryHash(model: CadModel): string {
  const hash = createHash("sha256");
  for (const entity of model.entities) {
    const { id: _id, ...rest } = entity;
    void _id;
    hash.update(JSON.stringify(rest, (_key, value) => (typeof value === "number" ? round3(value) : value)));
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 16);
}

/** 実図面の比較用の要約。お客様の名前が入りうるレイヤー名などは含めず、数とハッシュだけにする */
export function summarizeModel(model: CadModel) {
  const countsByType: Record<string, number> = {};
  for (const entity of model.entities) countsByType[entity.type] = (countsByType[entity.type] ?? 0) + 1;
  return {
    stats: model.stats,
    countsByType,
    layerCount: model.layers.length,
    hiddenLayerCount: model.layers.filter((layer) => !layer.visible).length,
    pointStyle: model.pointStyle ?? null,
    bounds: model.bounds
      ? { min: { x: round3(model.bounds.min.x), y: round3(model.bounds.min.y) }, max: { x: round3(model.bounds.max.x), y: round3(model.bounds.max.y) } }
      : null,
    geometryHash: geometryHash(model),
  };
}
