/// <reference lib="webworker" />
import DxfParser from "dxf-parser";
import { convertToCadModel } from "./DxfParserAdapter";
import { decodeDxfBuffer } from "./dxfEncoding";
import { detectDwgVersion } from "./dwgFormat";
import { extractLayerLineTypes } from "./layerLineTypes";
import { convertDwgToDxfBuffer } from "./dwgToDxf";
import type {
  DxfWorkerErrorMessage,
  DxfWorkerProgressMessage,
  DxfWorkerRequest,
  DxfWorkerSuccessMessage,
} from "./dxfWorkerProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function postProgress(stage: DxfWorkerProgressMessage["stage"], entityCount: number | null) {
  const message: DxfWorkerProgressMessage = { type: "progress", stage, entityCount };
  ctx.postMessage(message);
}

ctx.onmessage = async (event: MessageEvent<DxfWorkerRequest>) => {
  const startedAt = performance.now();
  try {
    postProgress("reading", null);
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
    const cadModel = convertToCadModel(raw, { layerLineTypes: extractLayerLineTypes(text) });
    console.log("[dxf.worker] converted CadModel stats", cadModel.stats);

    postProgress("preparing", cadModel.stats.totalEntityCount);

    const successMessage: DxfWorkerSuccessMessage = {
      type: "success",
      cadModel,
      elapsedMs: performance.now() - startedAt,
    };
    ctx.postMessage(successMessage);
  } catch (error) {
    const errorMessage: DxfWorkerErrorMessage = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(errorMessage);
  }
};
