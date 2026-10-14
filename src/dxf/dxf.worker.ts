/// <reference lib="webworker" />
import DxfParser from "dxf-parser";
import { convertToCadModel } from "./DxfParserAdapter";
import { decodeDxfBuffer } from "./dxfEncoding";
import { detectDwgVersion } from "./dwgFormat";
import { extractLayerStyles } from "./layerStyles";
import { convertDwgToDxfBuffer } from "./dwgToDxf";
import type {
  DxfWorkerErrorMessage,
  DxfWorkerProgressMessage,
  DxfWorkerRequest,
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
    let text: string;
    if (dwgVersion) {
      console.log("[dxf.worker] DWG detected", dwgVersion);
      postProgress("dwgConverting", null);
      text = decodeDxfBuffer(await convertDwgToDxfBuffer(buffer));
    } else {
      text = decodeDxfBuffer(buffer);
    }

    postProgress("parsing", null);
    const parser = new DxfParser();
    const raw = parser.parseSync(text);
    if (!raw) {
      throw new Error("DXFの解析結果が空です");
    }

    postProgress("converting", raw.entities?.length ?? null);
    const cadModel = convertToCadModel(raw, { layerStyles: extractLayerStyles(text), ignoreLayerOffFlag: dwgVersion !== null });
    console.log("[dxf.worker] converted CadModel stats", cadModel.stats);

    postProgress("preparing", cadModel.stats.totalEntityCount);

    const successMessage: DxfWorkerSuccessMessage = {
      type: "success",
      cadModel,
      elapsedMs: performance.now() - startedAt,
    };
    // 図形ごとの範囲配列は大きいので、コピーせずメインスレッドへ所有権を移す
    ctx.postMessage(successMessage, [cadModel.entityBounds.buffer]);
  } catch (error) {
    const errorMessage: DxfWorkerErrorMessage = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(errorMessage);
  }
};
