import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { LayerPanel } from "./components/LayerPanel";
import { PropertyPanel } from "./components/PropertyPanel";
import { MeasurementPanel } from "./components/MeasurementPanel";
import { StatusBar } from "./components/StatusBar";
import { StartScreen } from "./components/StartScreen";
import { ResizablePanel } from "./components/ResizablePanel";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { CadCanvas } from "./cad-view/CadCanvas";
import type { CadCanvasHandle } from "./cad-view/CadCanvas";
import { validateDxfFile } from "./dxf/validateDxfFile";
import type { DxfLoadingStage, DxfWorkerRequest, DxfWorkerResponse } from "./dxf/dxfWorkerProtocol";
import type { CadLayer, CadModel, DocumentInfo, Measurement, Point2D } from "./types/cad";
import "./App.css";

const DXF_ERROR_MESSAGE =
  "DXFの解析に失敗しました。\n\n考えられる原因：\n・ASCII DXFではない\n・ファイルが破損している\n・未対応形式";

type LoadingProgress = {
  stage: DxfLoadingStage;
  entityCount: number | null;
};

export default function App() {
  const [fileInfo, setFileInfo] = useState<DocumentInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMeasurementMode, setIsMeasurementMode] = useState(false);
  const [layers, setLayers] = useState<CadLayer[]>([]);
  const [cadModel, setCadModel] = useState<CadModel | null>(null);
  const [cursorWorld, setCursorWorld] = useState<Point2D | null>(null);
  const [selectedEntityIds, setSelectedEntityIds] = useState<ReadonlySet<string>>(new Set());
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const cadCanvasRef = useRef<CadCanvasHandle>(null);

  const selectedEntities = useMemo(
    () => cadModel?.entities.filter((entity) => selectedEntityIds.has(entity.id)) ?? [],
    [cadModel, selectedEntityIds],
  );

  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [loadStartedAt, setLoadStartedAt] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [leftWidth, setLeftWidth] = useState(200);
  const [rightWidth, setRightWidth] = useState(240);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const openFileInputRef = useRef<HTMLInputElement>(null);

  const isDocumentOpen = fileInfo !== null;

  const terminateWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const startDxfLoad = useCallback((file: File) => {
    terminateWorker();
    setErrorMessage(null);
    setLoadStartedAt(Date.now());
    setLoadingProgress({ stage: "reading", entityCount: null });

    const worker = new Worker(new URL("./dxf/dxf.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<DxfWorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        setLoadingProgress({ stage: message.stage, entityCount: message.entityCount });
      } else if (message.type === "success") {
        console.log("[App] DXF parse succeeded", {
          elapsedMs: message.elapsedMs,
          stats: message.cadModel.stats,
        });
        setLoadingProgress(null);
        setLoadStartedAt(null);
        setFileInfo({ fileName: file.name, fileSizeBytes: file.size });
        setLayers(message.cadModel.layers);
        setCadModel(message.cadModel);
        setSelectedEntityIds(new Set());
        setMeasurements([]);
        setSelectedMeasurementId(null);
        terminateWorker();
      } else if (message.type === "error") {
        console.error("[App] DXF parse failed", message.message);
        setLoadingProgress(null);
        setLoadStartedAt(null);
        setErrorMessage(DXF_ERROR_MESSAGE);
        terminateWorker();
      }
    };

    worker.onerror = (event) => {
      console.error("[App] DXF worker crashed", event.message);
      setLoadingProgress(null);
      setLoadStartedAt(null);
      setErrorMessage(DXF_ERROR_MESSAGE);
      terminateWorker();
    };

    const request: DxfWorkerRequest = { type: "parse", file };
    worker.postMessage(request);
  }, [terminateWorker]);

  const handleFileSelected = useCallback(
    async (file: File) => {
      const result = await validateDxfFile(file);
      if (!result.valid) {
        setErrorMessage(DXF_ERROR_MESSAGE);
        return;
      }
      startDxfLoad(file);
    },
    [startDxfLoad],
  );

  const handleCloseDocument = useCallback(() => {
    terminateWorker();
    setFileInfo(null);
    setLayers([]);
    setCadModel(null);
    setCursorWorld(null);
    setSelectedEntityIds(new Set());
    setMeasurements([]);
    setSelectedMeasurementId(null);
    setIsMeasurementMode(false);
  }, [terminateWorker]);

  const handleOpenFileRequest = useCallback(() => {
    openFileInputRef.current?.click();
  }, []);

  const handleOpenFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) {
        handleFileSelected(file);
      }
    },
    [handleFileSelected],
  );

  const handleToggleMeasurementMode = useCallback(() => {
    setIsMeasurementMode((prev) => {
      const next = !prev;
      if (next) setSelectedMeasurementId(null);
      return next;
    });
  }, []);

  const handleFitDrawing = useCallback(() => {
    cadCanvasRef.current?.fitToDrawing();
  }, []);

  const handleCursorMove = useCallback((worldPoint: Point2D | null) => {
    setCursorWorld(worldPoint);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  const handleSelectionChange = useCallback((entityIds: ReadonlySet<string>) => {
    setSelectedEntityIds(entityIds);
  }, []);

  const handleMeasurementComplete = useCallback((newMeasurement: Measurement) => {
    setMeasurements((prev) => [...prev, newMeasurement]);
  }, []);

  const handleMeasurementSelect = useCallback((measurementId: string | null) => {
    setSelectedMeasurementId(measurementId);
  }, []);

  const handleDeleteMeasurement = useCallback((measurementId: string) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== measurementId));
    setSelectedMeasurementId((prev) => (prev === measurementId ? null : prev));
  }, []);

  const handleDeleteAllMeasurements = useCallback(() => {
    setMeasurements([]);
    setSelectedMeasurementId(null);
  }, []);

  const handleToggleLayerVisibility = useCallback((layerName: string) => {
    setLayers((prev) =>
      prev.map((layer) => (layer.name === layerName ? { ...layer, visible: !layer.visible } : layer)),
    );
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isMeasurementMode) setIsMeasurementMode(false);
        setSelectedEntityIds(new Set());
        setSelectedMeasurementId(null);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedMeasurementId) {
        event.preventDefault();
        handleDeleteMeasurement(selectedMeasurementId);
      } else if (event.key === "o" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (isDocumentOpen) handleOpenFileRequest();
      } else if (event.key === "f" && isDocumentOpen) {
        handleFitDrawing();
      } else if (event.key === "m" && isDocumentOpen) {
        handleToggleMeasurementMode();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isDocumentOpen,
    isMeasurementMode,
    selectedMeasurementId,
    handleFitDrawing,
    handleToggleMeasurementMode,
    handleOpenFileRequest,
    handleDeleteMeasurement,
  ]);

  useEffect(() => {
    return () => terminateWorker();
  }, [terminateWorker]);

  if (!isDocumentOpen) {
    return (
      <>
        <StartScreen recentFiles={[]} errorMessage={errorMessage} onFileSelected={handleFileSelected} />
        {loadingProgress && loadStartedAt !== null && (
          <LoadingOverlay
            stage={loadingProgress.stage}
            entityCount={loadingProgress.entityCount}
            startedAt={loadStartedAt}
          />
        )}
      </>
    );
  }

  return (
    <div className="app-cad-layout">
      <input
        ref={openFileInputRef}
        type="file"
        accept=".dxf"
        style={{ display: "none" }}
        onChange={handleOpenFileInputChange}
      />
      <Toolbar
        isDocumentOpen={isDocumentOpen}
        isMeasurementMode={isMeasurementMode}
        onOpenFile={handleOpenFileRequest}
        onCloseDocument={handleCloseDocument}
        onToggleMeasurementMode={handleToggleMeasurementMode}
        onFitDrawing={handleFitDrawing}
        onToggleFullscreen={handleToggleFullscreen}
      />
      <div className="app-cad-layout__body">
        <ResizablePanel
          side="left"
          width={leftWidth}
          collapsed={leftCollapsed}
          onWidthChange={setLeftWidth}
          onCollapsedChange={setLeftCollapsed}
        >
          <LayerPanel layers={layers} onToggleVisibility={handleToggleLayerVisibility} />
        </ResizablePanel>

        <div className="app-cad-layout__canvas-area">
          <CadCanvas
            ref={cadCanvasRef}
            model={cadModel}
            layers={layers}
            selectedEntityIds={selectedEntityIds}
            selectionEnabled={!isMeasurementMode}
            measurementModeEnabled={isMeasurementMode}
            measurements={measurements}
            selectedMeasurementId={selectedMeasurementId}
            onSelectionChange={handleSelectionChange}
            onMeasurementComplete={handleMeasurementComplete}
            onMeasurementSelect={handleMeasurementSelect}
            onCursorMove={handleCursorMove}
          />
        </div>

        <ResizablePanel
          side="right"
          width={rightWidth}
          collapsed={rightCollapsed}
          onWidthChange={setRightWidth}
          onCollapsedChange={setRightCollapsed}
        >
          <div className="app-cad-layout__right-content">
            <PropertyPanel entities={selectedEntities} />
            <MeasurementPanel
              measurements={measurements}
              selectedMeasurementId={selectedMeasurementId}
              onSelectMeasurement={handleMeasurementSelect}
              onDeleteMeasurement={handleDeleteMeasurement}
              onDeleteAllMeasurements={handleDeleteAllMeasurements}
            />
          </div>
        </ResizablePanel>
      </div>
      <StatusBar fileInfo={fileInfo} cursorWorld={cursorWorld} />
      {loadingProgress && loadStartedAt !== null && (
        <LoadingOverlay stage={loadingProgress.stage} entityCount={loadingProgress.entityCount} startedAt={loadStartedAt} />
      )}
    </div>
  );
}
