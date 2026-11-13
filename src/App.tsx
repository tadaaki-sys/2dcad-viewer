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
import type { CadEntity, CadLayer, CadModel, DocumentInfo, Measurement, Point2D } from "./types/cad";
import { documentFromCadModel, hasEntity } from "./core/model";
import { describeHistoryOutcome, DOCUMENT_NOT_READY_MESSAGE, DocumentSession } from "./app/document/documentSession";
import type { DocumentChange } from "./app/document/documentSession";
import { renderModelFromDocument } from "./app/document/renderModel";
import type { ActiveCommand, SessionResult } from "./core/commands";
import { createAppCommands } from "./app/commands/builtinCommands";
import { defaultLayerName, resolveDrawTarget } from "./app/drawing/drawTarget";
import { reorderSelection } from "./app/document/reorder";
import { addEntitiesChangeSet } from "./core/history";
import type { AppRequest } from "./app/commands/builtinCommands";
import { isTypingTarget } from "./utils/dom";
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

/** Ctrl+Z(元に戻す)、Ctrl+YまたはCtrl+Shift+Z(やり直し)。該当しなければ null */
function historyShortcutOf(event: KeyboardEvent): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
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
  // 開いている図面のドキュメントと変更の履歴(Undo/Redo)。元データの準備(sourceメッセージ)が終わってから作る。
  // 図面を閉じる・開き直すときに解放する(履歴も一緒に捨てる)
  const documentSessionRef = useRef<DocumentSession | null>(null);
  // 開いた図面ごとの番号。画面は、番号が変わったときだけ全体表示する(編集・Undoでは表示位置を動かさない)
  const [drawingKey, setDrawingKey] = useState(0);
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
  // 初期のコンテキストは「描けない」。実際の状態は、下のeffectがすぐに設定する(コマンドを動かせるのは、その後)
  const [commands] = useState(() =>
    createAppCommands({
      isDocumentOpen,
      drawTarget: { ok: false, reason: DOCUMENT_NOT_READY_MESSAGE },
      allocateEntityId: () => {
        throw new Error("図面の準備ができていません");
      },
    }),
  );
  const commandSession = commands.session;
  // 新しい図形を描くレイヤー(現在のレイヤー)。図面を開くたびに、初期値(レイヤー0など)に戻す
  const [currentLayerName, setCurrentLayerName] = useState<string | null>(null);
  // ドキュメントと履歴の準備(元データの読み込み)が終わっていて、編集できるか
  const [isDocumentEditable, setIsDocumentEditable] = useState(false);
  useEffect(() => {
    commands.setContext({
      isDocumentOpen,
      drawTarget: isDocumentEditable
        ? resolveDrawTarget(layers, currentLayerName)
        : { ok: false, reason: DOCUMENT_NOT_READY_MESSAGE },
      allocateEntityId: () => {
        const session = documentSessionRef.current;
        if (session === null) throw new Error("図面の準備ができていません");
        return session.allocateEntityId();
      },
    });
  }, [commands, isDocumentOpen, isDocumentEditable, layers, currentLayerName]);
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [activeCommand, setActiveCommand] = useState<ActiveCommand | null>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const terminateWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  /** 図面(ドキュメント)が変わった(変更・Undo・Redo)ので、表示用のモデルを作り直して画面へ反映する */
  const handleDocumentChange = useCallback((change: DocumentChange) => {
    setCadModel(renderModelFromDocument(change.document));
    // 消えた図形が選択に残らないようにする(選択が変わらないときは、同じ集合のままにして余計な再描画を避ける)
    setSelectedEntityIds((previous) => {
      const kept = [...previous].filter((id) => hasEntity(change.document, id));
      return kept.length === previous.size ? previous : new Set(kept);
    });
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
        documentSessionRef.current = null;
        setIsDocumentEditable(false);
        setCurrentLayerName(defaultLayerName(message.cadModel.layers));
        setDrawingKey((key) => key + 1);
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
        if (pendingModel) {
          const session = new DocumentSession(documentFromCadModel(pendingModel));
          session.subscribe(handleDocumentChange);
          documentSessionRef.current = session;
          setIsDocumentEditable(true);
        }
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
  }, [terminateWorker, addRecentFile, commandSession, handleDocumentChange]);

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
    documentSessionRef.current = null;
    setIsDocumentEditable(false);
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

  const appendCommandLog = useCallback((lines: readonly string[]) => {
    if (lines.length > 0) setCommandLog((prev) => [...prev, ...lines].slice(-COMMAND_LOG_LIMIT));
  }, []);

  /** 元に戻す・やり直しを実行して、結果をコマンドラインに表示する */
  const performHistoryStep = useCallback(
    (kind: "undo" | "redo") => {
      const session = documentSessionRef.current;
      if (session === null) {
        appendCommandLog([DOCUMENT_NOT_READY_MESSAGE]);
        return;
      }
      try {
        appendCommandLog([describeHistoryOutcome(kind, kind === "undo" ? session.undo() : session.redo())]);
      } catch (error) {
        // 図面と履歴は更新済みだが、表示の更新で失敗した
        console.error("[App] failed to update the view after undo/redo", error);
        appendCommandLog(["表示の更新に失敗しました。図面を開き直してください"]);
      }
    },
    [appendCommandLog],
  );

  /** 作図コマンドが作った図形を、描画順の末尾(最前面)へ追加する(Undoの1段階) */
  const applyNewEntities = useCallback(
    (entities: readonly CadEntity[], label: string) => {
      const session = documentSessionRef.current;
      if (session === null) {
        appendCommandLog([DOCUMENT_NOT_READY_MESSAGE]);
        return;
      }
      try {
        const outcome = session.apply(addEntitiesChangeSet(session.document, entities, label));
        if (!outcome.ok) {
          appendCommandLog([`図形を追加できませんでした: ${outcome.error}`]);
          return;
        }
        // 描いている途中で、レイヤーを非表示にされたときは、見えない理由を伝える
        const layerName = entities[0]?.layer;
        if (layers.some((layer) => layer.name === layerName && !layer.visible)) {
          appendCommandLog([`レイヤー「${layerName}」は非表示のため、追加した図形は表示されません`]);
        }
      } catch (error) {
        console.error("[App] failed to update the view after adding entities", error);
        appendCommandLog(["表示の更新に失敗しました。図面を開き直してください"]);
      }
    },
    [appendCommandLog, layers],
  );

  const performReorder = useCallback(
    (direction: "front" | "back") => {
      const session = documentSessionRef.current;
      if (session === null) {
        appendCommandLog([DOCUMENT_NOT_READY_MESSAGE]);
        return;
      }
      try {
        appendCommandLog([reorderSelection(session, selectedEntityIds, direction)]);
      } catch (error) {
        console.error("[App] failed to update the view after reordering", error);
        appendCommandLog(["表示の更新に失敗しました。図面を開き直してください"]);
      }
    },
    [appendCommandLog, selectedEntityIds],
  );

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
        case "undo":
          performHistoryStep("undo");
          break;
        case "redo":
          performHistoryStep("redo");
          break;
        case "addEntities":
          applyNewEntities(request.entities, request.label);
          break;
        case "reorder":
          performReorder(request.direction);
          break;
      }
    },
    [
      handleOpenFileRequest,
      handleCloseDocument,
      handleFitDrawing,
      handleToggleMeasurementMode,
      handleToggleFullscreen,
      performHistoryStep,
      applyNewEntities,
      performReorder,
    ],
  );

  /** コマンドの結果を反映する(メッセージの表示、実行中の状態、アプリへの依頼の実行)。echo は、入力した文字の表示 */
  const applyCommandResult = useCallback(
    (result: SessionResult<AppRequest>, echo?: string) => {
      const lines = echo === undefined ? result.messages : [`> ${echo}`, ...result.messages];
      appendCommandLog(lines);
      setActiveCommand(result.active);
      for (const request of result.requests) executeRequest(request);
    },
    [appendCommandLog, executeRequest],
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
      const historyShortcut = historyShortcutOf(event);
      if (historyShortcut !== null) {
        if (!isDocumentOpen) return;
        event.preventDefault();
        // コマンドが入力を待っている間は、図面を戻さない。ただし作図中のCtrl+Zは、「1点戻す(U)」として働く
        const active = commandSession.active;
        if (active !== null) {
          if (historyShortcut === "undo" && active.keywords.includes("U")) {
            applyCommandResult(commandSession.submitKeyword("U"));
          }
          return;
        }
        runCommand(historyShortcut === "undo" ? "UNDO" : "REDO");
        return;
      }
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
        event.preventDefault();
        if (commandSession.active?.acceptsEnter) {
          // 作図中(点の指示を待っていて、Enterで終われる)のEnterは、作図の終了
          applyCommandResult(commandSession.submitText(""));
        } else {
          // Enterキーで、コマンドラインの入力欄へ移る
          commandInputRef.current?.focus();
        }
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

  // 開発サーバーのときだけ、E2Eテスト用の入口(window.__cadDev)を用意する。本番ビルドには含まれない
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    import("./devHooks").then((module) => {
      if (cancelled) return;
      dispose = module.installDevHooks({ getSession: () => documentSessionRef.current });
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

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
            drawingKey={drawingKey}
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
