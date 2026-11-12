import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { LayerPanel } from "./components/LayerPanel";
import { PropertyPanel } from "./components/PropertyPanel";
import { MeasurementPanel } from "./components/MeasurementPanel";
import { StatusBar } from "./components/StatusBar";
import { StartScreen } from "./components/StartScreen";
import { CommandLine } from "./components/CommandLine";
import { ResizablePanel } from "./components/ResizablePanel";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { CadCanvas } from "./cad-view/CadCanvas";
import type { CadCanvasHandle } from "./cad-view/CadCanvas";
import { PerformanceOverlay } from "./components/PerformanceOverlay";
import { useRecentFiles } from "./hooks/useRecentFiles";
import { validateDxfFile } from "./io/dxf/validateDxfFile";
import { isDwgFileName } from "./io/dxf/dwgFormat";
import type { DxfLoadingStage, DxfWorkerRequest, DxfWorkerResponse } from "./io/dxf/dxfWorkerProtocol";
import type { CadLayer, CadModel, DocumentInfo, Measurement, Point2D } from "./types/cad";
import { documentFromCadModel } from "./core/model";
import type { ActiveCommand, SessionResult } from "./core/commands";
import { createAppCommands } from "./app/commands/builtinCommands";
import type { AppRequest } from "./app/commands/builtinCommands";
import { isTypingTarget } from "./utils/dom";
import type { CadDocument } from "./core/model";
import { summarizeSource } from "./io/dxf/source";
import type { DxfSource, SourceSummary } from "./io/dxf/source";
import "./App.css";

const DXF_ERROR_MESSAGE =
  "DXFの解析に失敗しました。\n\n考えられる原因：\n・ASCII DXFではない\n・ファイルが破損している\n・未対応形式";

const DWG_ERROR_MESSAGE =
  "DWGの読み込みに失敗しました。\n\n考えられる原因：\n・ファイルが破損している\n・パスワード保護されている\n・未対応のDWGバージョン/内容\n\n対処：AutoCADで「名前を付けて保存」から、DXFまたは旧形式のDWGとして保存し直してお試しください。";

function loadErrorMessageFor(file: File): string {
  return isDwgFileName(file.name) ? DWG_ERROR_MESSAGE : DXF_ERROR_MESSAGE;
}

/** コマンドラインに残すメッセージの最大行数 */
const COMMAND_LOG_LIMIT = 100;

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
  const [parseTimeMs, setParseTimeMs] = useState<number | null>(null);
  // 編集機能(Phase 2以降)のために保持する。いまは表示に使わない。図面を閉じる・開き直すときに解放する
  const documentRef = useRef<CadDocument | null>(null);
  const sourceRef = useRef<DxfSource | null>(null);
  const [sourceSummary, setSourceSummary] = useState<SourceSummary | null>(null);
  const cadCanvasRef = useRef<CadCanvasHandle>(null);
  const { recentFiles, addRecentFile } = useRecentFiles();

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

  // コマンド(ツールバー・ショートカット・コマンドライン・図面のクリックは、すべてこの1つの入口から動く)
  const [commands] = useState(() => createAppCommands({ isDocumentOpen }));
  const commandSession = commands.session;
  useEffect(() => {
    commands.setContext({ isDocumentOpen });
  }, [commands, isDocumentOpen]);
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [activeCommand, setActiveCommand] = useState<ActiveCommand | null>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const terminateWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const startDxfLoad = useCallback((file: File) => {
    terminateWorker();
    setErrorMessage(null);
    setLoadStartedAt(Date.now());
    setLoadingProgress({ stage: "reading", entityCount: null });

    const worker = new Worker(new URL("./io/dxf/dxf.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    // このワーカーが、図面のデータ(success)を送り終えたか。送った後の異常で、表示中の図面を止めないために使う
    let succeeded = false;
    let pendingModel: CadModel | null = null;

    worker.onmessage = (event: MessageEvent<DxfWorkerResponse>) => {
      // 別の図面を開き直した・閉じた後に、前のワーカーから遅れて届いたメッセージは捨てる
      // (受け付けると、前の図面の元データが混ざったり、今読み込み中のワーカーを止めてしまう)
      if (workerRef.current !== worker) return;
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
        addRecentFile(file.name);
        setLayers(message.cadModel.layers);
        setCadModel(message.cadModel);
        // 元データは、図面の表示を遅らせないよう、続けて届く(sourceメッセージ)。それまでは、前の図面の分を残さない
        sourceRef.current = null;
        documentRef.current = null;
        setSourceSummary(null);
        // 前の図面のコマンドの途中経過と直前の点は、新しい図面には持ち越さない
        commandSession.reset();
        setActiveCommand(null);
        succeeded = true;
        pendingModel = message.cadModel;
        setSelectedEntityIds(new Set());
        setMeasurements([]);
        setSelectedMeasurementId(null);
        setParseTimeMs(message.elapsedMs);
        // ワーカーは、元データを送り終えるまで止めない(sourceメッセージで止める)
      } else if (message.type === "source") {
        sourceRef.current = message.source;
        if (pendingModel) documentRef.current = documentFromCadModel(pendingModel);
        pendingModel = null;
        setSourceSummary(summarizeSource(message.source));
        terminateWorker();
      } else if (message.type === "error") {
        console.error("[App] DXF parse failed", message.message);
        setLoadingProgress(null);
        setLoadStartedAt(null);
        setErrorMessage(loadErrorMessageFor(file));
        terminateWorker();
      }
    };

    worker.onerror = (event) => {
      if (workerRef.current !== worker) return;
      console.error("[App] DXF worker crashed", event.message);
      // 図面の表示が済んだあとの異常(元データを作る途中など)では、表示中の図面を止めない
      if (succeeded) {
        terminateWorker();
        return;
      }
      setLoadingProgress(null);
      setLoadStartedAt(null);
      setErrorMessage(loadErrorMessageFor(file));
      terminateWorker();
    };

    const request: DxfWorkerRequest = { type: "parse", file };
    worker.postMessage(request);
  }, [terminateWorker, addRecentFile, commandSession]);

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
    sourceRef.current = null;
    documentRef.current = null;
    setSourceSummary(null);
    setCursorWorld(null);
    setSelectedEntityIds(new Set());
    setMeasurements([]);
    setSelectedMeasurementId(null);
    setIsMeasurementMode(false);
    commandSession.reset();
    setActiveCommand(null);
  }, [terminateWorker, commandSession]);

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

  const executeRequest = useCallback(
    (request: AppRequest) => {
      switch (request.type) {
        case "openFile":
          handleOpenFileRequest();
          break;
        case "closeDocument":
          handleCloseDocument();
          break;
        case "fitDrawing":
          handleFitDrawing();
          break;
        case "toggleMeasurement":
          handleToggleMeasurementMode();
          break;
        case "toggleFullscreen":
          handleToggleFullscreen();
          break;
      }
    },
    [handleOpenFileRequest, handleCloseDocument, handleFitDrawing, handleToggleMeasurementMode, handleToggleFullscreen],
  );

  /** コマンドの結果を反映する(メッセージの表示、実行中の状態、アプリへの依頼の実行)。echo は、入力した文字の表示 */
  const applyCommandResult = useCallback(
    (result: SessionResult<AppRequest>, echo?: string) => {
      const lines = echo === undefined ? result.messages : [`> ${echo}`, ...result.messages];
      if (lines.length > 0) setCommandLog((prev) => [...prev, ...lines].slice(-COMMAND_LOG_LIMIT));
      setActiveCommand(result.active);
      for (const request of result.requests) executeRequest(request);
    },
    [executeRequest],
  );

  /** 名前を指定してコマンドを動かす(ツールバーのボタンとショートカット用) */
  const runCommand = useCallback(
    (name: string) => {
      applyCommandResult(commandSession.run(name));
    },
    [applyCommandResult, commandSession],
  );

  const handleCommandSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      applyCommandResult(commandSession.submitText(text), trimmed === "" ? undefined : trimmed);
    },
    [applyCommandResult, commandSession],
  );

  const handleCommandCancel = useCallback(() => {
    applyCommandResult(commandSession.cancel());
  }, [applyCommandResult, commandSession]);

  /** 図面のクリックで点が指示された */
  const handlePointPick = useCallback(
    (worldPoint: Point2D) => {
      const result = commandSession.submitPoint(worldPoint);
      applyCommandResult(result);
      // 続けて入力を待つなら、座標を打てるように入力欄へ。終わったなら、ショートカット(F・M)が効くように入力欄を外す
      if (result.active) commandInputRef.current?.focus();
      else commandInputRef.current?.blur();
    },
    [applyCommandResult, commandSession],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // 入力欄に文字を打っているときは、ショートカットとして扱わない(コマンドラインへの「f」で全体表示しないように)
      if (isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        // コマンドの実行中は、コマンドの取り消しだけを行う(測定の終了・選択の解除は、次のEscで)
        if (commandSession.active) {
          applyCommandResult(commandSession.cancel());
          return;
        }
        if (isMeasurementMode) setIsMeasurementMode(false);
        setSelectedEntityIds(new Set());
        setSelectedMeasurementId(null);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedMeasurementId) {
        event.preventDefault();
        handleDeleteMeasurement(selectedMeasurementId);
      } else if (event.key === "o" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (isDocumentOpen) runCommand("OPEN");
      } else if (event.key === "f" && isDocumentOpen) {
        runCommand("FIT");
      } else if (event.key === "m" && isDocumentOpen) {
        runCommand("MEASURE");
      } else if (
        event.key === "Enter" &&
        isDocumentOpen &&
        event.target === document.body &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        // Enterキーで、コマンドラインの入力欄へ移る
        event.preventDefault();
        commandInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isDocumentOpen,
    isMeasurementMode,
    selectedMeasurementId,
    commandSession,
    applyCommandResult,
    runCommand,
    handleDeleteMeasurement,
  ]);

  useEffect(() => {
    return () => terminateWorker();
  }, [terminateWorker]);

  if (!isDocumentOpen) {
    return (
      <>
        <StartScreen recentFiles={recentFiles} errorMessage={errorMessage} onFileSelected={handleFileSelected} />
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
        accept=".dxf,.dwg"
        style={{ display: "none" }}
        onChange={handleOpenFileInputChange}
      />
      <Toolbar
        isDocumentOpen={isDocumentOpen}
        isMeasurementMode={isMeasurementMode}
        onOpenFile={() => runCommand("OPEN")}
        onCloseDocument={() => runCommand("CLOSE")}
        onToggleMeasurementMode={() => runCommand("MEASURE")}
        onFitDrawing={() => runCommand("FIT")}
        onToggleFullscreen={() => runCommand("FULLSCREEN")}
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
            pointPickEnabled={activeCommand?.expect === "point"}
            measurements={measurements}
            selectedMeasurementId={selectedMeasurementId}
            onSelectionChange={handleSelectionChange}
            onMeasurementComplete={handleMeasurementComplete}
            onMeasurementSelect={handleMeasurementSelect}
            onPointPick={handlePointPick}
            onCursorMove={handleCursorMove}
          />
          {import.meta.env.DEV && (
            <PerformanceOverlay
              cadCanvasRef={cadCanvasRef}
              parseTimeMs={parseTimeMs}
              sourceSummary={sourceSummary}
              entityCount={
                cadModel
                  ? { total: cadModel.stats.totalEntityCount, supported: cadModel.stats.supportedEntityCount }
                  : null
              }
            />
          )}
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
      <CommandLine
        log={commandLog}
        active={activeCommand}
        inputRef={commandInputRef}
        onSubmit={handleCommandSubmit}
        onCancel={handleCommandCancel}
      />
      <StatusBar fileInfo={fileInfo} cursorWorld={cursorWorld} stats={cadModel?.stats ?? null} />
      {loadingProgress && loadStartedAt !== null && (
        <LoadingOverlay stage={loadingProgress.stage} entityCount={loadingProgress.entityCount} startedAt={loadStartedAt} />
      )}
    </div>
  );
}
