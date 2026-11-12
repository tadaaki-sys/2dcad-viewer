/// <reference lib="webworker" />
import DxfParser from "dxf-parser";
import { convertToCadModelWithOrigin } from "./DxfParserAdapter";
import { decodeDxfBuffer } from "./dxfEncoding";
import { detectDwgVersion } from "./dwgFormat";
import { extractLayerStyles } from "./layerStyles";
import { convertDwgToDxfBuffer } from "./dwgToDxf";
import { buildDxfSource, transferablesOf } from "./source";
import type { DxfSource } from "./source";
import type {
  DxfWorkerErrorMessage,
  DxfWorkerProgressMessage,
  DxfWorkerRequest,
  DxfWorkerSourceMessage,
  DxfWorkerSuccessMessage,
} from "./dxfWorkerProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// 読み込み〜解析〜変換でファイルサイズの数倍のメモリを使うため、現実的な上限を設ける
const MAX_FILE_BYTES = 512 * 1024 * 1024;

function postProgress(stage: DxfWorkerProgressMessage["stage"], entityCount: number | null) {
  const message: DxfWorkerProgressMessage = { type: "progress", stage, entityCount };
  ctx.postMessage(message);
}

ctx.onmessage = async (event: MessageEvent<DxfWorkerRequest>) => {
  const startedAt = performance.now();
  try {
    postProgress("reading", null);
    if (event.data.file.size > MAX_FILE_BYTES) {
      throw new Error(`ファイルが大きすぎます(${Math.round(event.data.file.size / 1024 / 1024)}MB)。${MAX_FILE_BYTES / 1024 / 1024}MBまでのファイルに対応しています。`);
    }
    const buffer = await event.data.file.arrayBuffer();

    // 拡張子ではなく先頭のバージョン識別子でDWGを判別し、DXFへ変換してから既存のDXF処理に流す
    const dwgVersion = detectDwgVersion(buffer);
    // 保存のために保持する元データ。DXFならファイルそのもの、DWGなら変換後のDXF
    let dxfBuffer: ArrayBuffer;
    if (dwgVersion) {
      console.log("[dxf.worker] DWG detected", dwgVersion);
      postProgress("dwgConverting", null);
      dxfBuffer = await convertDwgToDxfBuffer(buffer);
    } else {
      dxfBuffer = buffer;
    }
    const text = decodeDxfBuffer(dxfBuffer);

    postProgress("parsing", null);
    const parser = new DxfParser();
    const raw = parser.parseSync(text);
    if (!raw) {
      throw new Error("DXFの解析結果が空です");
    }

    postProgress("converting", raw.entities?.length ?? null);
    const { model: cadModel, origin } = convertToCadModelWithOrigin(raw, {
      layerStyles: extractLayerStyles(text),
      ignoreLayerOffFlag: dwgVersion !== null,
    });
    console.log("[dxf.worker] converted CadModel stats", cadModel.stats);

    postProgress("preparing", cadModel.stats.totalEntityCount);

    const successMessage: DxfWorkerSuccessMessage = {
      type: "success",
      cadModel,
      elapsedMs: performance.now() - startedAt,
    };
    // 範囲配列は大きいので、コピーせずメインスレッドへ所有権を移す
    ctx.postMessage(successMessage, [cadModel.entityBounds.buffer]);

    // 図面が表示されたあとに、元データ(バイト列、記録の索引、解析結果との対応表)を作って送る。
    // 作れなくても、ビューアの表示はそのまま続ける(編集が無効になるだけ)
    let source: DxfSource | null = null;
    try {
      source = buildDxfSource(
        new Uint8Array(dxfBuffer),
        (raw.entities ?? []).map((entity) => ({ type: entity.type, handle: entity.handle === undefined ? undefined : String(entity.handle) })),
        origin,
      );
    } catch (sourceError) {
      console.warn("[dxf.worker] 元データを作れませんでした", sourceError);
    }
    const sourceMessage: DxfWorkerSourceMessage = { type: "source", source };
    ctx.postMessage(sourceMessage, source ? transferablesOf(source) : []);
  } catch (error) {
    const errorMessage: DxfWorkerErrorMessage = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(errorMessage);
  }
};
