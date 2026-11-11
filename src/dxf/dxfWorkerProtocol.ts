import type { CadModel } from "../types/cad";
import type { DxfSource } from "../io/dxf/source";

export type DxfLoadingStage = "reading" | "dwgConverting" | "parsing" | "converting" | "preparing";

export type DxfWorkerRequest = {
  type: "parse";
  file: File;
};

export type DxfWorkerProgressMessage = {
  type: "progress";
  stage: DxfLoadingStage;
  entityCount: number | null;
};

export type DxfWorkerSuccessMessage = {
  type: "success";
  cadModel: CadModel;
  elapsedMs: number;
};

/**
 * 元のバイト列と記録の索引など。図面の表示を遅らせないよう、successの後に別のメッセージで送る。
 * 索引を作れなかった場合はnull(表示には影響せず、編集だけが無効になる)。
 */
export type DxfWorkerSourceMessage = {
  type: "source";
  source: DxfSource | null;
};

export type DxfWorkerErrorMessage = {
  type: "error";
  message: string;
};

export type DxfWorkerResponse = DxfWorkerProgressMessage | DxfWorkerSuccessMessage | DxfWorkerSourceMessage | DxfWorkerErrorMessage;
