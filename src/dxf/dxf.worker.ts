/// <reference lib="webworker" />
import DxfParser from "dxf-parser";
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
    const text = await event.data.file.text();

    postProgress("parsing", null);
    const parser = new DxfParser();
    const raw = parser.parseSync(text);
    const entityCount = raw?.entities?.length ?? 0;

    postProgress("converting", entityCount);
    // 内部CADモデルへの変換はPhase3のDxfParserAdapterで実装する
    console.log("[dxf.worker] raw parse result", raw);

    postProgress("preparing", entityCount);

    const successMessage: DxfWorkerSuccessMessage = {
      type: "success",
      entityCount,
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
