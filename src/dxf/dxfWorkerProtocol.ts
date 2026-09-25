import type { CadModel } from "../types/cad";

export type DxfLoadingStage = "reading" | "parsing" | "converting" | "preparing";

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

export type DxfWorkerErrorMessage = {
  type: "error";
  message: string;
};

export type DxfWorkerResponse = DxfWorkerProgressMessage | DxfWorkerSuccessMessage | DxfWorkerErrorMessage;
