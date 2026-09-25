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
  entityCount: number;
  elapsedMs: number;
};

export type DxfWorkerErrorMessage = {
  type: "error";
  message: string;
};

export type DxfWorkerResponse = DxfWorkerProgressMessage | DxfWorkerSuccessMessage | DxfWorkerErrorMessage;
