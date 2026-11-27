import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import type { CadEntity, CadLayer, CadLineType, CadModel, DocumentInfo, Measurement, Point2D } from "./types/cad";
import { buildLineTypeTable, createDashFactory } from "./core/style/lineTypes";
import { LayerManagerPanel } from "./components/LayerManagerPanel";
import { createLayer, deleteLayer, editLayer, moveToLayer, renameLayer, setLineTypeScale } from "./app/document/layering";
import type { LayerPatch } from "./app/document/layering";
import type { GripTarget, LayerPanelTab } from "./app/commands/types";
import { gripCountOf, gripsOf, MAX_GRIP_ENTITIES, MAX_GRIPS } from "./core/grip/grips";
import { gripKeyOf } from "./cad-view/renderer/gripRender";
import type { GripMark } from "./cad-view/renderer/gripRender";
import { addVertexAt, deleteVertexAt, moveGrip, setGeometryProperty, setPolylinesClosed } from "./app/document/gripEditing";
import { setStyleProperty } from "./app/document/propertyEditing";
import type { StyleProperty } from "./app/document/propertyEditing";
import type { GeometryField } from "./core/geometry/propertyGeometry";
import { withLockedLayers } from "./app/document/editability";
import { reorderEntities, textToFront } from "./app/document/reorder";
import { createGroup, editGroup, renameGroup, ungroup } from "./app/document/grouping";
import { expandSelectionChange } from "./core/group/groups";
import type { SelectionChangeMode } from "./core/group/groups";
import { setLayerLocked } from "./app/document/layering";
import { GroupPanel } from "./components/GroupPanel";
import type { CadGroup } from "./types/cad";
import { documentFromCadModel, hasEntity } from "./core/model";
import { describeHistoryOutcome, DOCUMENT_NOT_READY_MESSAGE, DocumentSession } from "./app/document/documentSession";
import type { DocumentChange, DocumentSessionState } from "./app/document/documentSession";
import { renderModelFromDocument } from "./app/document/renderModel";
import {
  FIELD_LABELS,
  applyTypedValues,
  dynamicModeOf,
  formatDynamicValue,
  inputFieldsOf,
  nextField,
  parseCoordinateInput,
  parseFieldText,
  resolveDynamicPoint,
} from "./core/commands";
import type { ActiveCommand, DynamicField, DynamicMode, DynamicValues, SessionResult } from "./core/commands";
import { DynamicInput } from "./components/DynamicInput";
import type { SnapSettings } from "./core/snap/snapSettings";
import type { SnapToggleSetting, TrackingToggleSetting } from "./app/commands/builtinCommands";
import { loadSnapSettings, saveSnapSettings } from "./utils/snapSettingsStorage";
import { toggleTracking } from "./core/tracking/trackingSettings";
import type { TrackingSettings } from "./core/tracking/trackingSettings";
import { loadTrackingSettings, saveTrackingSettings } from "./utils/trackingSettingsStorage";
import { createAppCommands } from "./app/commands/builtinCommands";
import { defaultLayerName, resolveDrawTarget, resolveNamedLayerTarget } from "./app/drawing/drawTarget";
import { reorderSelection } from "./app/document/reorder";
import { createAppEditing } from "./app/document/appEditing";
import { createEditability } from "./app/document/editability";
import type { Editability, EditabilitySource } from "./app/document/editability";
import { copyEntities, deleteEntities, stretchEntities, transformEntities } from "./app/document/editing";
import { breakAt } from "./app/document/breaking";
import { cornerAt } from "./app/document/filleting";
import { reassociateDimension } from "./app/document/dimensioning";
import { editTextContent } from "./app/document/texting";
import { currentTextStyle, DEFAULT_TEXT_STYLE } from "./core/text/textStyle";
import { currentDimensionStyle, DEFAULT_DIMENSION_STYLE } from "./core/dimension/dimensionStyle";
import type { DimensionStyleTable } from "./core/dimension/dimensionStyle";
import { loadDimensionStyleTable, saveDimensionStyleTable } from "./utils/dimensionStyleStorage";
import { DimensionStylePanel } from "./components/DimensionStylePanel";
import type { TextStyleTable } from "./core/text/textStyle";
import { loadTextStyleTable, saveTextStyleTable } from "./utils/textStyleStorage";
import { TextInputPanel } from "./components/TextInputPanel";
import { TextStylePanel } from "./components/TextStylePanel";
import { offsetAt } from "./app/document/offsetting";
import { trimOrExtendAt } from "./app/document/trimming";
import type { EditOutcome } from "./app/document/editing";
import { NO_EDITING } from "./app/commands/types";
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

const NO_HISTORY_STATE: DocumentSessionState = { canUndo: false, canRedo: false, isDirty: false };

const EMPTY_DYNAMIC_VALUES: DynamicValues = {};

/** Snap の設定の切り替えを、コマンドラインに表示するときの名前 */
const SNAP_SETTING_LABELS: Record<SnapToggleSetting, string> = {
  objectSnap: "OSNAP(図形への吸着)",
  gridSnap: "SNAP(格子点への吸着)",
  gridDisplay: "GRID(格子点の表示)",
};

/** F3=OSNAP、F7=GRID、F9=SNAP(AutoCAD と同じ) */
const SNAP_FUNCTION_KEYS: Record<string, SnapToggleSetting> = { F3: "objectSnap", F7: "gridDisplay", F9: "gridSnap" };

/** F8=ORTHO、F10=POLAR、F11=OTRACK(AutoCAD と同じ。F11 は、ブラウザの全画面の切り替えと重なる環境がある) */
const TRACKING_FUNCTION_KEYS: Record<string, TrackingToggleSetting> = { F8: "ortho", F10: "polar", F11: "objectTracking" };

/**
 * 取り込んだ図形の分類(元データ)を、編集可否の判断に使う形に直す(io/ の分類を、app/ の層へ渡す橋渡し)。
 * 元データが無い、または元データとの対応づけに失敗した図面は、null(取り込んだ図形は、編集できない)。
 */
function editabilitySourceOf(model: CadModel | null, source: DxfSource | null): EditabilitySource | null {
  if (model === null || source === null || source.recordOfParserEntity === null || source.classification === null) return null;
  return {
    importedIndexById: new Map(model.entities.map((entity, index) => [entity.id, index])),
    nested: source.origin.nested,
    parserIndex: source.origin.parserIndex,
  };
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
  // グリップのクリックで始まる GRIPEDIT が、動かすグリップ(コマンドが始まるときに、1回だけ取り出す)と、動かしている最中のグリップ(赤く描く)
  const pendingGripRef = useRef<GripTarget | null>(null);
  const [hotGrip, setHotGrip] = useState<GripMark | null>(null);
  // グループ単位の選択(PICKSTYLE。Phase 19)。初期はオン。選択の変更のたびに読むので、参照にも写す
  const [pickStyle, setPickStyle] = useState(true);
  const pickStyleRef = useRef(true);
  // グループの一覧のパネル(GROUPS)と、画面が読むグループ表(ドキュメントから写す)
  const [showGroups, setShowGroups] = useState(false);
  const [groups, setGroups] = useState<readonly CadGroup[]>([]);
  // 図面の線種表と、全体の線種尺度(新しい図形の破線を作る・レイヤー管理パネルに見せる)。図面のドキュメントから写す
  const [lineStyle, setLineStyle] = useState<{ lineTypes: readonly CadLineType[]; ltScale: number }>(() => ({ lineTypes: buildLineTypeTable(undefined), ltScale: 1 }));
  const dashes = useMemo(() => createDashFactory(lineStyle.lineTypes, lineStyle.ltScale), [lineStyle]);
  // レイヤーの管理パネル(LAYER・LINETYPE・LINEWEIGHT)
  const [layerPanelTab, setLayerPanelTab] = useState<LayerPanelTab | null>(null);
  // 画面の layers(表示用)が、いまのドキュメントのどのレイヤー表の写しか(変わったときだけ、画面の側を更新する)
  const documentLayersRef = useRef<readonly CadLayer[] | null>(null);
  // 表示中のレイヤー(TRIM・EXTEND で、非表示のレイヤーの図形を、対象にも境界にもしないため)
  const visibleLayerNames = useMemo(() => new Set(layers.filter((layer) => layer.visible).map((layer) => layer.name)), [layers]);
  // 図面のクリックの、図形を指す許容距離(図面上の長さ。クリックのたびに、画面の拡大率から受け取る)
  const pickToleranceRef = useRef(1);
  // コマンドが、クリックの位置の図形を探すときに使う(表示中のレイヤー)。最新の値を、再描画なしで読めるように入れ物に入れる
  const visibleLayerNamesRef = useRef<ReadonlySet<string>>(visibleLayerNames);
  useLayoutEffect(() => {
    visibleLayerNamesRef.current = visibleLayerNames;
  });
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
      editing: NO_EDITING,
      textStyle: DEFAULT_TEXT_STYLE,
      dimensionStyle: DEFAULT_DIMENSION_STYLE,
      layerTarget: () => ({ ok: false, reason: DOCUMENT_NOT_READY_MESSAGE }),
      ltScale: 1,
      allocateEntityId: () => {
        throw new Error("図面の準備ができていません");
      },
    }),
  );
  // 編集してよい図形の判断(取り込んだ図形の分類。元データが届いたときに作る)と、いまの選択(コマンドが、始まる時点の最新を読めるように)
  const editabilityRef = useRef<Editability>(createEditability(null));
  // 描画(グリップ・プロパティ欄)が読む、編集可否の判断。参照(ref)と同じものを、状態にも持つ
  const [editabilityState, setEditabilityState] = useState<Editability>(() => createEditability(null));
  const selectedIdsRef = useRef<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    selectedIdsRef.current = selectedEntityIds;
  });
  const commandSession = commands.session;
  // 新しい図形を描くレイヤー(現在のレイヤー)。図面を開くたびに、初期値(レイヤー0など)に戻す
  const [currentLayerName, setCurrentLayerName] = useState<string | null>(null);
  // 画面に見せる・削除の判断に使う、現在のレイヤー。なくなったとき(作成を Undo したなど)は、初期値(レイヤー0など)にする(ラジオが、どれも選ばれない状態にしない)
  const activeLayerName = useMemo(
    () => (currentLayerName !== null && layers.some((layer) => layer.name === currentLayerName) ? currentLayerName : defaultLayerName(layers)),
    [layers, currentLayerName],
  );
  // ドキュメントと履歴の準備(元データの読み込み)が終わっていて、編集できるか
  const [isDocumentEditable, setIsDocumentEditable] = useState(false);
  // 元に戻す・やり直しができるか、未保存の変更があるか(ボタンの有効・無効と、未保存の表示・確認に使う)
  const [sessionState, setSessionState] = useState<DocumentSessionState>(NO_HISTORY_STATE);
  // コマンドの状態が変わるたびに増える番号(ゴム紐を作り直すきっかけ)
  const [commandRevision, setCommandRevision] = useState(0);
  // Snap の設定(OSNAP・SNAP・GRID と、種類ごとのオン・オフ、格子の間隔)。このブラウザに保存する
  const [snapSettings, setSnapSettings] = useState<SnapSettings>(loadSnapSettings);
  useEffect(() => {
    saveSnapSettings(snapSettings);
  }, [snapSettings]);
  // トラッキングの設定(ORTHO・POLAR・OTRACK、角度の刻み、間隔)。同じく、このブラウザに保存する
  const [trackingSettings, setTrackingSettings] = useState<TrackingSettings>(loadTrackingSettings);
  useEffect(() => {
    saveTrackingSettings(trackingSettings);
  }, [trackingSettings]);
  // 文字スタイルの一覧と、現在のスタイル(TEXT・MTEXT で描く文字の見た目)。同じく、このブラウザに保存する。TEXTSTYLE で、管理パネルを開く
  const [textStyles, setTextStyles] = useState<TextStyleTable>(loadTextStyleTable);
  useEffect(() => {
    saveTextStyleTable(textStyles);
  }, [textStyles]);
  const [showTextStyles, setShowTextStyles] = useState(false);
  // 寸法スタイルの一覧と、現在のスタイル(寸法を描くときの見た目)。同じく、このブラウザに保存する。DIMSTYLE で、管理パネルを開く
  const [dimensionStyles, setDimensionStyles] = useState<DimensionStyleTable>(loadDimensionStyleTable);
  useEffect(() => {
    saveDimensionStyleTable(dimensionStyles);
  }, [dimensionStyles]);
  const [showDimensionStyles, setShowDimensionStyles] = useState(false);
  useEffect(() => {
    commands.setContext({
      isDocumentOpen,
      drawTarget:
        loadingProgress !== null
          ? { ok: false, reason: "図面を読み込み中です。完了してからお試しください" }
          : isDocumentEditable
            ? resolveDrawTarget(layers, currentLayerName, dashes)
            : { ok: false, reason: DOCUMENT_NOT_READY_MESSAGE },
      editing: createAppEditing({
        ready: isDocumentEditable && loadingProgress === null,
        getSession: () => documentSessionRef.current,
        getEditability: () => withLockedLayers(editabilityRef.current, () => documentSessionRef.current?.document ?? null),
        getSelection: () => selectedIdsRef.current,
        getVisibleLayerNames: () => visibleLayerNamesRef.current,
        getPickTolerance: () => pickToleranceRef.current,
        takePendingGrip: () => {
          const grip = pendingGripRef.current;
          pendingGripRef.current = null;
          return grip;
        },
      }),
      allocateEntityId: () => {
        const session = documentSessionRef.current;
        if (session === null) throw new Error("図面の準備ができていません");
        return session.allocateEntityId();
      },
      textStyle: currentTextStyle(textStyles),
      dimensionStyle: currentDimensionStyle(dimensionStyles),
      layerTarget: (name) => resolveNamedLayerTarget(layers, name, dashes),
      ltScale: lineStyle.ltScale,
    });
  }, [commands, isDocumentOpen, isDocumentEditable, layers, currentLayerName, loadingProgress, textStyles, dimensionStyles, dashes, lineStyle.ltScale]);
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [activeCommand, setActiveCommand] = useState<ActiveCommand | null>(null);
  // グリップ(選択した、編集できる図形のつかむ点)。コマンド・測定・読み込みの最中は出さない。選択が多すぎる・グリップが多すぎるときも出さない
  // ロックされたレイヤー(Phase 19)。図形を選べず、編集できない(グリップ・プロパティの編集欄にも出さない)
  const lockedLayerNames = useMemo(() => new Set(layers.filter((layer) => layer.locked === true).map((layer) => layer.name)), [layers]);
  // レイヤーをロックしたら、そのレイヤーの図形を、選択から外す(ロックした図形は選べない、という決まりを、選んであった図形にも当てる)
  useEffect(() => {
    if (lockedLayerNames.size === 0) return;
    const session = documentSessionRef.current;
    if (session === null) return;
    const document = session.document;
    setSelectedEntityIds((previous) => {
      if (previous.size === 0) return previous;
      const kept = new Set<string>();
      for (const id of previous) {
        const index = document.indexById.get(id);
        if (index === undefined || !lockedLayerNames.has(document.entities[index].layer)) kept.add(id);
      }
      return kept.size === previous.size ? previous : kept;
    });
  }, [lockedLayerNames]);
  // 選択を待つ段階が、グループ単位に広げない段階(GROUPEDIT で図形を選ぶとき)か。選択の変更の処理(handleSelectionChange)が見る
  const individualSelectionRef = useRef(false);
  useEffect(() => {
    individualSelectionRef.current = activeCommand?.individualSelection === true;
  }, [activeCommand]);
  const gripMarks = useMemo((): GripMark[] => {
    if (!isDocumentEditable || loadingProgress !== null || activeCommand !== null || isMeasurementMode || selectedEntities.length === 0) return [];
    const editable = selectedEntities.filter((entity) => editabilityState.isEditable(entity.id) && !lockedLayerNames.has(entity.layer));
    if (editable.length === 0 || editable.length > MAX_GRIP_ENTITIES) return [];
    let total = 0;
    for (const entity of editable) total += gripCountOf(entity);
    if (total > MAX_GRIPS) return [];
    return editable.flatMap((entity) => gripsOf(entity).map((grip) => ({ key: gripKeyOf(entity.id, grip.index), entityId: entity.id, index: grip.index, kind: grip.kind, point: grip.point })));
  }, [isDocumentEditable, loadingProgress, activeCommand, isMeasurementMode, selectedEntities, editabilityState, lockedLayerNames]);
  const commandInputRef = useRef<HTMLInputElement>(null);

  // ダイナミック入力(カーソル付近の X・Y・長さ・角度の表示と、数値の入力)。
  // 入力はコマンドラインで受け、Tab で確定した値(locked)と、いま入力している項目(field)をここで持つ。
  // 値は、コマンドの状態が進む(revision が変わる)たびに捨てる。点の指示・キーワード・コマンドの終了のあと、古い値が残らないように
  const [cursorScreen, setCursorScreen] = useState<Point2D | null>(null);
  const [commandText, setCommandText] = useState("");
  const [dynamicState, setDynamicState] = useState<{ revision: number; locked: DynamicValues; field: DynamicField }>({
    revision: -1,
    locked: {},
    field: "x",
  });
  // 打っている途中の値が変わったときに増える(ゴム紐を作り直すきっかけ)
  const [dynamicTick, setDynamicTick] = useState(0);
  const dynamicMode = dynamicModeOf(activeCommand);
  const dynamicFields = dynamicMode === null ? [] : inputFieldsOf(dynamicMode);
  const dynamicIsCurrent = dynamicState.revision === commandRevision && dynamicFields.includes(dynamicState.field);
  const dynamicLocked: DynamicValues = dynamicIsCurrent ? dynamicState.locked : EMPTY_DYNAMIC_VALUES;
  const dynamicField: DynamicField = dynamicIsCurrent ? dynamicState.field : (dynamicFields[0] ?? "x");
  // 描画・キー操作のコールバックから、最新の値を読むための入れ物(コールバックを作り直さずに済む)
  const dynamicRef = useRef({
    mode: null as DynamicMode | null,
    base: null as Point2D | null,
    locked: EMPTY_DYNAMIC_VALUES,
    field: "x" as DynamicField,
    text: "",
    cursor: null as Point2D | null,
    revision: 0,
  });
  // 描画後すぐ(子の effect より前)に最新の値へ更新する。子(CadCanvas)がゴム紐を作り直すとき、古い値を読まないように
  useLayoutEffect(() => {
    dynamicRef.current = {
      mode: dynamicMode,
      base: activeCommand?.basePoint ?? null,
      locked: dynamicLocked,
      field: dynamicField,
      text: commandText,
      cursor: cursorWorld,
      revision: commandRevision,
    };
  });
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [canvasAreaSize, setCanvasAreaSize] = useState<{ width: number; height: number } | null>(null);

  const terminateWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  /** 図面(ドキュメント)が変わった(変更・Undo・Redo)ので、表示用のモデルを作り直して画面へ反映する */
  const handleDocumentChange = useCallback((change: DocumentChange) => {
    setSessionState(change.state);
    // 履歴の破棄・保存済みの記録では、図面は変わらない(状態だけが変わる)
    if (change.kind === "reset" || change.kind === "saved") return;
    // レイヤー表(作成・変更・削除・表示の切り替え)が変わったときだけ、画面のレイヤー一覧と線種尺度を更新する
    if (change.document.layers !== documentLayersRef.current) {
      documentLayersRef.current = change.document.layers;
      setLayers(change.document.layers.slice());
    }
    setLineStyle((previous) => (previous.ltScale === change.document.ltScale ? previous : { lineTypes: change.document.lineTypes, ltScale: change.document.ltScale }));
    setGroups(change.document.groups);
    // レイヤーの表示・非表示だけの変更では、図形は変わらないので、描画用のモデルは作り直さない
    if (change.kind === "view") return;
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
        editabilityRef.current = createEditability(null);
        setEditabilityState(editabilityRef.current);
        documentSessionRef.current = null;
        setIsDocumentEditable(false);
        setSessionState(NO_HISTORY_STATE);
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
        editabilityRef.current = createEditability(editabilitySourceOf(pendingModel, message.source));
        setEditabilityState(editabilityRef.current);
        if (pendingModel) {
          const session = new DocumentSession(documentFromCadModel(pendingModel));
          session.subscribe(handleDocumentChange);
          documentSessionRef.current = session;
          documentLayersRef.current = session.document.layers;
          setGroups(session.document.groups);
          setLineStyle({ lineTypes: session.document.lineTypes, ltScale: session.document.ltScale });
          setIsDocumentEditable(true);
          setSessionState(session.state);
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
    documentLayersRef.current = null;
    setLayerPanelTab(null);
    setShowGroups(false);
    setGroups([]);
    setCadModel(null);
    sourceRef.current = null;
    editabilityRef.current = createEditability(null);
    setEditabilityState(editabilityRef.current);
    documentSessionRef.current = null;
    setIsDocumentEditable(false);
    setSessionState(NO_HISTORY_STATE);
    setSourceSummary(null);
    setCursorWorld(null);
    setCursorScreen(null);
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

  const handleCursorMove = useCallback((worldPoint: Point2D | null, screenPoint: Point2D | null) => {
    setCursorWorld(worldPoint);
    setCursorScreen(screenPoint);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  const handleSelectionChange = useCallback((entityIds: ReadonlySet<string>, mode: SelectionChangeMode = "replace") => {
    // グループ単位の選択(Phase 19): 選び足した図形のグループの全員を足し、外した図形のグループの全員を外す
    const session = documentSessionRef.current;
    if (session === null || !pickStyleRef.current || individualSelectionRef.current || session.document.groups.length === 0) {
      setSelectedEntityIds(entityIds);
      return;
    }
    const document = session.document;
    const selectable = (id: string): boolean => {
      const index = document.indexById.get(id);
      if (index === undefined) return false;
      const layer = document.layers[document.layerIndexByName.get(document.entities[index].layer) ?? -1];
      return layer !== undefined && layer.visible && layer.locked !== true;
    };
    setSelectedEntityIds((previous) => expandSelectionChange(document.groups, previous, entityIds, selectable, mode));
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
    // 表示・非表示は、ドキュメントのレイヤー表に持つ(履歴・未保存の状態には入れない表示設定)。レイヤー管理の変更を Undo しても、保たれる
    const session = documentSessionRef.current;
    const current = session?.document.layers.find((layer) => layer.name === layerName);
    if (session !== null && current !== undefined) {
      session.setLayerVisible(layerName, !current.visible);
      return;
    }
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

  /**
   * 未保存の変更があるとき、図面を閉じる・別の図面を開く前に確認する。続けてよければ true。
   * (保存の機能は、まだ無い。確認なしに閉じると、描いたものを失う)
   */
  const confirmDiscardChanges = useCallback(
    (action: "close" | "open"): boolean => {
      // いまの状態を、ドキュメントから直接読む。画面の状態(sessionState)は、同じ処理の中で図形を追加した直後は、まだ古い
      // (作図の途中で「閉じる」を押すと、描きかけの図形を確定してから閉じる依頼が続くため)
      if (!(documentSessionRef.current?.isDirty ?? false)) return true;
      const message =
        action === "close"
          ? "未保存の変更があります。図面を閉じると、変更は失われます(保存の機能は、まだありません)。閉じますか?"
          : "未保存の変更があります。別の図面を開くと、変更は失われます(保存の機能は、まだありません)。開きますか?";
      return window.confirm(message);
    },
    [],
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
        appendCommandLog([reorderSelection(session, withLockedLayers(editabilityRef.current, () => session.document), selectedEntityIds, direction)]);
      } catch (error) {
        console.error("[App] failed to update the view after reordering", error);
        appendCommandLog(["表示の更新に失敗しました。図面を開き直してください"]);
      }
    },
    [appendCommandLog, selectedEntityIds],
  );

  /** 編集(移動・回転・複写・削除・鏡像・拡大縮小・ストレッチ)を、図面に適用して、結果の説明を表示する(Undo の1段階) */
  const applyEdit = useCallback(
    (run: (session: DocumentSession, editability: Editability) => EditOutcome) => {
      const session = documentSessionRef.current;
      if (session === null) {
        appendCommandLog([DOCUMENT_NOT_READY_MESSAGE]);
        return;
      }
      try {
        const message = run(session, withLockedLayers(editabilityRef.current, () => session.document)).message;
        // 連動寸法の追従で知らせること(参照が切れた・関連付けを解除した)も、続けて知らせる
        const notice = session.takeNotice();
        appendCommandLog(notice === null ? [message] : [message, notice]);
      } catch (error) {
        console.error("[App] failed to apply an edit", error);
        appendCommandLog(["表示の更新に失敗しました。図面を開き直してください"]);
      }
    },
    [appendCommandLog],
  );

  /** レイヤー管理パネルからの編集。結果(成功・失敗の説明)を、パネルにもコマンドラインにも見せるため、applyEdit と違って、結果を返す */
  const runLayerEdit = useCallback(
    (run: (session: DocumentSession, editability: Editability) => EditOutcome): EditOutcome => {
      const session = documentSessionRef.current;
      if (session === null || loadingProgress !== null) {
        const refused: EditOutcome = { ok: false, message: DOCUMENT_NOT_READY_MESSAGE };
        appendCommandLog([refused.message]);
        return refused;
      }
      try {
        const outcome = run(session, withLockedLayers(editabilityRef.current, () => session.document));
        const notice = session.takeNotice();
        appendCommandLog(notice === null ? [outcome.message] : [outcome.message, notice]);
        return outcome;
      } catch (error) {
        console.error("[App] failed to edit layers", error);
        const failed: EditOutcome = { ok: false, message: "レイヤーの更新に失敗しました。図面を開き直してください" };
        appendCommandLog([failed.message]);
        return failed;
      }
    },
    [appendCommandLog, loadingProgress],
  );

  /** レイヤーを指定している寸法スタイルの名前(レイヤーの名前変更・削除のとき、直すよう知らせる) */
  const dimensionStylesUsingLayer = useCallback((layerName: string) => dimensionStyles.styles.filter((style) => style.layer === layerName).map((style) => style.name), [dimensionStyles]);

  const handleCreateLayer = useCallback((input: { name: string; color: string }) => runLayerEdit((session) => createLayer(session, input)), [runLayerEdit]);
  const handleEditLayer = useCallback((name: string, patch: LayerPatch) => runLayerEdit((session) => editLayer(session, name, patch)), [runLayerEdit]);
  const handleRenameLayer = useCallback(
    (from: string, to: string) => {
      const outcome = runLayerEdit((session) => renameLayer(session, from, to));
      if (!outcome.ok) return outcome;
      // 現在のレイヤーを、変えた名前に合わせる(名前は、検証で前後の空白を取った値になる)
      const renamedTo = documentSessionRef.current?.document.layers.find((layer) => layer.name === to.trim())?.name;
      if (renamedTo !== undefined) setCurrentLayerName((current) => (current === from ? renamedTo : current));
      const styles = dimensionStylesUsingLayer(from);
      if (styles.length === 0) return outcome;
      const warning = `寸法スタイル ${styles.map((s) => `「${s}」`).join("")} が、旧い名前「${from}」のレイヤーを指定しています。寸法スタイルのレイヤーを直してください`;
      appendCommandLog([warning]);
      return { ok: true, message: `${outcome.message}。${warning}` };
    },
    [runLayerEdit, dimensionStylesUsingLayer, appendCommandLog],
  );
  const handleDeleteLayer = useCallback(
    (name: string) => {
      const outcome = runLayerEdit((session) => deleteLayer(session, name, activeLayerName));
      if (!outcome.ok) return outcome;
      const styles = dimensionStylesUsingLayer(name);
      if (styles.length === 0) return outcome;
      const warning = `寸法スタイル ${styles.map((s) => `「${s}」`).join("")} が、削除したレイヤー「${name}」を指定しています。寸法スタイルのレイヤーを直してください`;
      appendCommandLog([warning]);
      return { ok: true, message: `${outcome.message}。${warning}` };
    },
    [runLayerEdit, activeLayerName, dimensionStylesUsingLayer, appendCommandLog],
  );
  const handleMoveSelectedToLayer = useCallback(
    (name: string) => runLayerEdit((session, editability) => moveToLayer(session, editability, [...selectedIdsRef.current], name)),
    [runLayerEdit],
  );
  const handleSetLtScale = useCallback((value: number) => runLayerEdit((session) => setLineTypeScale(session, value)), [runLayerEdit]);
  // レイヤーのロック(Phase 19)。レイヤー管理パネルのチェックと、左の Layers 欄の鍵
  const handleSetLayerLocked = useCallback((name: string, locked: boolean) => runLayerEdit((session) => setLayerLocked(session, name, locked)), [runLayerEdit]);
  const handleToggleLayerLock = useCallback(
    (name: string) => {
      const layer = documentSessionRef.current?.document.layers.find((l) => l.name === name);
      if (layer !== undefined) handleSetLayerLocked(name, layer.locked !== true);
    },
    [handleSetLayerLocked],
  );
  // グループの一覧のパネル(Phase 19)
  const handleSelectGroup = useCallback((group: CadGroup) => {
    const session = documentSessionRef.current;
    if (session === null) return;
    const document = session.document;
    // 選べる図形(表示中・ロックされていないレイヤー)だけを選ぶ
    const ids = group.ids.filter((id) => {
      const index = document.indexById.get(id);
      if (index === undefined) return false;
      const layer = document.layers[document.layerIndexByName.get(document.entities[index].layer) ?? -1];
      return layer !== undefined && layer.visible && layer.locked !== true;
    });
    setSelectedEntityIds(new Set(ids));
  }, []);
  const handleRenameGroup = useCallback((from: string, to: string) => runLayerEdit((session) => renameGroup(session, from, to)), [runLayerEdit]);
  const handleUngroupFromPanel = useCallback((group: CadGroup) => runLayerEdit((session) => ungroup(session, group.ids)), [runLayerEdit]);
  const handleTogglePickStyle = useCallback(() => {
    const next = !pickStyleRef.current;
    pickStyleRef.current = next;
    setPickStyle(next);
    appendCommandLog([`グループ単位の選択(PICKSTYLE): ${next ? "オン" : "オフ"}`]);
  }, [appendCommandLog]);

  const executeRequest = useCallback(
    (request: AppRequest) => {
      // 新しい図面を読み込んでいる間は、いまの図面を変更しない(読み込みが終わると、いまの図面と変更は置き換えられるため)
      const changesDocument =
        request.type === "undo" ||
        request.type === "redo" ||
        request.type === "addEntities" ||
        request.type === "reorder" ||
        request.type === "transformEntities" ||
        request.type === "copyEntities" ||
        request.type === "deleteEntities" ||
        request.type === "stretchEntities" ||
        request.type === "trimAt" ||
        request.type === "offsetEntity" ||
        request.type === "breakEntity" ||
        request.type === "filletEntities" ||
        request.type === "chamferEntities" ||
        request.type === "editText" ||
        request.type === "reassociateDimension" ||
        request.type === "setLineTypeScale" ||
        request.type === "moveToLayer" ||
        request.type === "moveGrip" ||
        request.type === "addVertex" ||
        request.type === "deleteVertex" ||
        request.type === "setPolylinesClosed" ||
        request.type === "drawOrder" ||
        request.type === "textToFront" ||
        request.type === "createGroup" ||
        request.type === "ungroup" ||
        request.type === "editGroup";
      if (changesDocument && loadingProgress !== null) {
        appendCommandLog(["図面を読み込み中です。完了してからお試しください"]);
        return;
      }
      switch (request.type) {
        case "openFile":
          if (confirmDiscardChanges("open")) handleOpenFileRequest();
          break;
        case "closeDocument":
          if (confirmDiscardChanges("close")) handleCloseDocument();
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
        case "toggleSnapSetting": {
          const next = { ...snapSettings, [request.setting]: !snapSettings[request.setting] };
          setSnapSettings(next);
          appendCommandLog([`${SNAP_SETTING_LABELS[request.setting]}: ${next[request.setting] ? "オン" : "オフ"}`]);
          break;
        }
        case "toggleTrackingSetting": {
          const toggled = toggleTracking(trackingSettings, request.setting);
          setTrackingSettings(toggled.settings);
          appendCommandLog([toggled.message]);
          break;
        }
        case "transformEntities":
          applyEdit((session, editability) => transformEntities(session, editability, request.ids, request.matrix, request.label, request.noun));
          break;
        case "copyEntities":
          applyEdit((session, editability) => copyEntities(session, editability, request.ids, request.matrices, request.label));
          break;
        case "deleteEntities":
          applyEdit((session, editability) => deleteEntities(session, editability, request.ids, request.label));
          break;
        case "stretchEntities":
          applyEdit((session, editability) => stretchEntities(session, editability, request.ids, request.window, request.dx, request.dy, request.label));
          break;
        case "trimAt":
          applyEdit((session, editability) =>
            trimOrExtendAt(session, editability, request.mode, request.point, pickToleranceRef.current, request.edgeIds, visibleLayerNames),
          );
          break;
        case "offsetEntity":
          applyEdit((session, editability) => offsetAt(session, editability, request.id, request.distance, request.point));
          break;
        case "breakEntity":
          applyEdit((session, editability) => breakAt(session, editability, request.id, request.first, request.second));
          break;
        case "filletEntities":
          applyEdit((session, editability) => cornerAt(session, editability, { kind: "fillet", radius: request.radius }, request.first, request.second));
          break;
        case "chamferEntities":
          applyEdit((session, editability) =>
            cornerAt(session, editability, { kind: "chamfer", distance1: request.distance1, distance2: request.distance2 }, request.first, request.second),
          );
          break;
        case "editText":
          applyEdit((session, editability) => editTextContent(session, editability, request.id, request.text));
          break;
        case "reassociateDimension":
          applyEdit((session, editability) => reassociateDimension(session, editability, request.id, request.dimension));
          break;
        case "setLineTypeScale":
          applyEdit((session) => setLineTypeScale(session, request.value));
          break;
        case "moveToLayer":
          applyEdit((session, editability) => moveToLayer(session, editability, request.ids, request.layer));
          break;
        case "openLayers":
          setLayerPanelTab(request.tab);
          break;
        case "moveGrip":
          applyEdit((session, editability) => moveGrip(session, editability, request.id, request.index, request.point));
          break;
        case "addVertex":
          applyEdit((session, editability) => addVertexAt(session, editability, request.id, request.point));
          break;
        case "deleteVertex":
          // クリックした位置から、頂点までの許容距離は、図形を指す許容距離の2倍(頂点を指しやすく、線分の途中では、遠くの頂点を消さない)
          applyEdit((session, editability) => deleteVertexAt(session, editability, request.id, request.point, pickToleranceRef.current * 2));
          break;
        case "setPolylinesClosed":
          applyEdit((session, editability) => setPolylinesClosed(session, editability, request.ids, request.closed));
          break;
        case "drawOrder":
          applyEdit((session, editability) => reorderEntities(session, editability, request.ids, request.placement));
          break;
        case "textToFront":
          applyEdit((session, editability) => textToFront(session, editability));
          break;
        case "createGroup":
          applyEdit((session, editability) => createGroup(session, editability, request.ids, request.name));
          break;
        case "ungroup":
          applyEdit((session, editability) => ungroup(session, request.ids, editability));
          break;
        case "editGroup":
          applyEdit((session, editability) => editGroup(session, editability, request.name, request.ids, request.mode));
          break;
        case "openGroups":
          setShowGroups(true);
          break;
        case "togglePickStyle":
          handleTogglePickStyle();
          break;
        case "openDimensionStyles":
          setShowDimensionStyles(true);
          break;
        case "openTextStyles":
          setShowTextStyles(true);
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
      confirmDiscardChanges,
      loadingProgress,
      appendCommandLog,
      applyEdit,
      visibleLayerNames,
      snapSettings,
      trackingSettings,
      handleTogglePickStyle,
    ],
  );

  /** GRID・SNAP・OSNAP のオン・オフ(ステータスバーのボタンと F7・F9・F3)。実行中のコマンドは、終わらせずに続ける */
  const handleToggleSnap = useCallback(
    (setting: SnapToggleSetting) => executeRequest({ type: "toggleSnapSetting", setting }),
    [executeRequest],
  );

  /** ORTHO・POLAR・OTRACK のオン・オフ(ステータスバーのボタンと F8・F10・F11)。実行中のコマンドは、終わらせずに続ける */
  const handleToggleTracking = useCallback(
    (setting: TrackingToggleSetting) => executeRequest({ type: "toggleTrackingSetting", setting }),
    [executeRequest],
  );

  /** コマンドの結果を反映する(メッセージの表示、実行中の状態、アプリへの依頼の実行)。echo は、入力した文字の表示 */
  const applyCommandResult = useCallback(
    (result: SessionResult<AppRequest>, echo?: string) => {
      const lines = echo === undefined ? result.messages : [`> ${echo}`, ...result.messages];
      appendCommandLog(lines);
      setActiveCommand(result.active);
      setCommandRevision((revision) => revision + 1);
      for (const request of result.requests) executeRequest(request);
    },
    [appendCommandLog, executeRequest],
  );

  /** グリップをクリックした: そのグリップを動かすコマンド(GRIPEDIT)を始める */
  const handleGripClick = useCallback(
    (grip: GripMark) => {
      pendingGripRef.current = { id: grip.entityId, index: grip.index, point: grip.point };
      setHotGrip(grip);
      applyCommandResult(commandSession.run("GRIPEDIT"));
    },
    [applyCommandResult, commandSession],
  );

  /** プロパティ欄からの編集(色・線種・線の太さ・線種尺度・値)。結果を、パネルにも、コマンドラインにも見せる */
  const handleSetStyleProperty = useCallback(
    (ids: readonly string[], change: StyleProperty) => runLayerEdit((session, editability) => setStyleProperty(session, editability, ids, change)),
    [runLayerEdit],
  );
  const handleSetGeometryProperty = useCallback(
    (id: string, field: GeometryField, value: number) => runLayerEdit((session, editability) => setGeometryProperty(session, editability, id, field, value)),
    [runLayerEdit],
  );

  /** 名前を指定してコマンドを動かす(ツールバーのボタンとショートカット用) */
  const runCommand = useCallback(
    (name: string) => {
      applyCommandResult(commandSession.run(name));
    },
    [applyCommandResult, commandSession],
  );

  /** 点の指示を済ませたあとの、入力欄の扱い。続けて入力を待つなら、座標を打てるように入力欄へ。終わったなら、ショートカット(F・M)が効くように外す */
  const focusCommandLineFor = useCallback((result: SessionResult<AppRequest>) => {
    if (result.active) commandInputRef.current?.focus();
    else commandInputRef.current?.blur();
  }, []);

  /**
   * 選択を待っている編集コマンド(MOVE など)で、Enter が押された: いまの選択を、コマンドへ渡す。
   * 選択を待っていなければ、false(何もしない)。続けて入力を待つなら、座標を打てるように入力欄へ。
   */
  const confirmSelectionStep = useCallback((): boolean => {
    if (commandSession.active?.expect !== "selection") return false;
    const result = commandSession.submitSelection([...selectedIdsRef.current]);
    applyCommandResult(result);
    focusCommandLineFor(result);
    return true;
  }, [applyCommandResult, commandSession, focusCommandLineFor]);

  const handleCommandSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      // 選択を待っている間の、空の Enter は、いまの選択を渡す(文字が入っているときは、コマンドの案内に任せる)
      if (trimmed === "" && confirmSelectionStep()) return;
      // ダイナミック入力: 数値だけ(例: 長さ 1500)を打った、または、Tab で確定した値があるときは、点に直して指示する。
      // 座標(1000,500 など)・キーワード・コマンド名・空のEnter(確定した値が無いとき)は、これまでどおりコマンドへ渡す
      const dynamic = dynamicRef.current;
      if (dynamic.mode === "absolute" || dynamic.mode === "polar") {
        const hasLocked = Object.keys(dynamic.locked).length > 0;
        const isPlainNumber = trimmed !== "" && (() => {
          const parsed = parseCoordinateInput(trimmed, null);
          return parsed.ok && parsed.kind === "distance";
        })();
        if (isPlainNumber || (trimmed === "" && hasLocked)) {
          const values: DynamicValues = { ...dynamic.locked };
          if (isPlainNumber) {
            const parsed = parseFieldText(dynamic.field, trimmed);
            if (!parsed.ok) {
              appendCommandLog([`> ${trimmed}`, parsed.error]);
              return;
            }
            values[dynamic.field] = parsed.value;
          }
          const echo = inputFieldsOf(dynamic.mode)
            .filter((field) => values[field] !== undefined)
            .map((field) => `${FIELD_LABELS[field]} ${formatDynamicValue(field, values[field] as number)}`)
            .join(", ");
          const resolved = resolveDynamicPoint(dynamic.mode, dynamic.base, dynamic.cursor, values);
          if (!resolved.ok) {
            appendCommandLog([`> ${echo}`, resolved.error]);
            return;
          }
          const result = commandSession.submitPoint(resolved.point);
          applyCommandResult(result, echo);
          focusCommandLineFor(result);
          return;
        }
      }
      applyCommandResult(commandSession.submitText(text), trimmed === "" ? undefined : trimmed);
    },
    [applyCommandResult, appendCommandLog, commandSession, focusCommandLineFor, confirmSelectionStep],
  );

  /** コマンドラインでの Tab: ダイナミック入力の、次(Shift+Tab なら前)の項目へ。打っていた値は、その項目の値として確定する */
  const handleCommandTab = useCallback(
    (text: string, backwards: boolean): boolean | "keep" => {
      const dynamic = dynamicRef.current;
      // 項目が1つだけ(数値だけを待つ段階)や、対象でない段階では、何もしない(ブラウザ標準の動き)
      if (dynamic.mode !== "absolute" && dynamic.mode !== "polar") return false;
      const trimmed = text.trim();
      let locked = dynamic.locked;
      if (trimmed !== "") {
        const parsed = parseFieldText(dynamic.field, trimmed);
        if (!parsed.ok) {
          // 読み取れない値は、確定せず、項目も動かさない。打った文字は残す(直せるように)
          appendCommandLog([`> ${trimmed}`, parsed.error]);
          return "keep";
        }
        locked = { ...locked, [dynamic.field]: parsed.value };
      }
      setDynamicState({ revision: dynamic.revision, locked, field: nextField(dynamic.mode, dynamic.field, backwards) });
      setDynamicTick((tick) => tick + 1);
      return true;
    },
    [appendCommandLog],
  );

  /** コマンドラインに打っている文字が変わった。カーソル付近の表示と、ゴム紐に反映する */
  const handleCommandTextChange = useCallback((text: string) => {
    setCommandText(text);
    setDynamicTick((tick) => tick + 1);
  }, []);

  const handleCommandCancel = useCallback(() => {
    applyCommandResult(commandSession.cancel());
  }, [applyCommandResult, commandSession]);

  /** 文字の入力パネルで確定した文字を、コマンドへ渡す(空・長すぎるときは、コマンドが理由を出して、同じ段階で待つ) */
  const handleTextEditorSubmit = useCallback(
    (text: string) => {
      const result = commandSession.submitText(text);
      applyCommandResult(result);
      focusCommandLineFor(result);
    },
    [applyCommandResult, commandSession, focusCommandLineFor],
  );

  /** 図面のクリックで点が指示された */
  const handlePointPick = useCallback(
    (worldPoint: Point2D, pickToleranceWorld: number) => {
      pickToleranceRef.current = pickToleranceWorld;
      // 打っている値・確定した値があるときは、ゴム紐に見えているとおりの点を指示する(クリックは、向きなどを決める)
      const d = dynamicRef.current;
      const point = applyTypedValues(d.mode, d.base, worldPoint, d.locked, d.field, d.text) ?? worldPoint;
      const result = commandSession.submitPoint(point);
      applyCommandResult(result);
      focusCommandLineFor(result);
    },
    [applyCommandResult, commandSession, focusCommandLineFor],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // F3・F7・F9(Snap の切り替え)は、文字ではないので、コマンドラインに打っている最中でも効く。実行中のコマンドは終わらせない
      const snapSetting = SNAP_FUNCTION_KEYS[event.key];
      if (snapSetting !== undefined && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        // 押し続けたときのキーの繰り返しでは、切り替えない(繰り返しの回数で、最終的な状態が変わらないように)
        if (isDocumentOpen && !event.repeat) handleToggleSnap(snapSetting);
        return;
      }
      const trackingSetting = TRACKING_FUNCTION_KEYS[event.key];
      if (trackingSetting !== undefined && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (isDocumentOpen && !event.repeat) handleToggleTracking(trackingSetting);
        return;
      }
      // 入力欄に文字を打っているときは、ショートカットとして扱わない(コマンドラインへの「f」で全体表示しないように)
      if (isTypingTarget(event.target)) return;
      // コマンドが数値を待っているときの、数字・小数点・マイナスのキーは、コマンドラインへ移して打ち始める
      // (カーソル付近の表示に、打っている値が映る)。フォーカスだけを移し、キーの入力は入力欄に入る
      if (
        /^[0-9.-]$/.test(event.key) &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        dynamicModeOf(commandSession.active) !== null
      ) {
        commandInputRef.current?.focus();
        return;
      }
      // Ctrl+Shift+A: グループ単位の選択の、オン・オフ(PICKSTYLE。Phase 19)。実行中のコマンドは、終わらせない
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toUpperCase() === "A") {
        if (!isDocumentOpen) return;
        event.preventDefault();
        handleTogglePickStyle();
        return;
      }
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
      } else if (
        event.key === "Delete" &&
        isDocumentOpen &&
        !commandSession.active &&
        selectedIdsRef.current.size > 0 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        // 選択中の図形を削除する(DELETE コマンドと同じ。Undo で戻せる)。入力欄に文字を打っているときは、ここへ来ない
        event.preventDefault();
        runCommand("DELETE");
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
        if (commandSession.active?.expect === "selection") {
          // 選択を待っている編集コマンドのEnterは、いまの選択の確定
          confirmSelectionStep();
        } else if (commandSession.active?.acceptsEnter) {
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
    handleToggleSnap,
    handleToggleTracking,
    confirmSelectionStep,
    handleTogglePickStyle,
  ]);

  /** コマンドラインの入力欄でのCtrl+Z。作図中なら「1点戻す(U)」として受け取る。受け取れないときは false(入力欄の文字の取り消し) */
  const handleCommandLineUndoShortcut = useCallback((): boolean => {
    const active = commandSession.active;
    if (active === null || !active.keywords.includes("U")) return false;
    applyCommandResult(commandSession.submitKeyword("U"));
    return true;
  }, [applyCommandResult, commandSession]);

  /**
   * 作図中のゴム紐(カーソル位置に応じた仮の図形)。図面のデータは変えない。
   * ダイナミック入力で値を打っている(または確定した)ときは、その値を反映した点を使う(例: 長さを打つと、その長さの線が見える)
   */
  const getPreview = useCallback(
    (worldPoint: Point2D) => {
      const d = dynamicRef.current;
      const point = applyTypedValues(d.mode, d.base, worldPoint, d.locked, d.field, d.text) ?? worldPoint;
      return commandSession.previewAt(point);
    },
    [commandSession],
  );

  // カーソル付近の表示が、はみ出さずに収まる範囲(図面の表示領域の大きさ)
  useEffect(() => {
    const element = canvasAreaRef.current;
    if (!element) return;
    const update = () => setCanvasAreaSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isDocumentOpen]);

  // 未保存の変更があるまま(または、描きかけの図形があるまま)、ページを閉じる・再読み込みしようとしたときに、ブラウザの確認を出す
  const hasUnsavedWork = sessionState.isDirty || (activeCommand?.hasPendingChanges ?? false);
  useEffect(() => {
    if (!hasUnsavedWork) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedWork]);

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
        isEditable={isDocumentEditable}
        canUndo={sessionState.canUndo}
        canRedo={sessionState.canRedo}
        activeCommandName={activeCommand?.name ?? null}
        onDraw={runCommand}
        onUndo={() => runCommand("UNDO")}
        onRedo={() => runCommand("REDO")}
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
          <LayerPanel
            layers={layers}
            currentLayerName={activeLayerName}
            onToggleVisibility={handleToggleLayerVisibility}
            onSelectCurrent={setCurrentLayerName}
            onManage={isDocumentEditable ? () => setLayerPanelTab("layers") : undefined}
            onToggleLock={isDocumentEditable ? handleToggleLayerLock : undefined}
          />
        </ResizablePanel>

        <div className="app-cad-layout__canvas-area" ref={canvasAreaRef}>
          <CadCanvas
            ref={cadCanvasRef}
            model={cadModel}
            drawingKey={drawingKey}
            layers={layers}
            selectedEntityIds={selectedEntityIds}
            selectionEnabled={!isMeasurementMode}
            measurementModeEnabled={isMeasurementMode}
            pointPickEnabled={activeCommand?.expect === "point"}
            pointPickRaw={activeCommand?.rawPoints === true}
            measurements={measurements}
            selectedMeasurementId={selectedMeasurementId}
            onSelectionChange={handleSelectionChange}
            onMeasurementComplete={handleMeasurementComplete}
            onMeasurementSelect={handleMeasurementSelect}
            onPointPick={handlePointPick}
            getPreview={getPreview}
            previewRevision={commandRevision + dynamicTick}
            snapSettings={snapSettings}
            snapFromPoint={activeCommand?.basePoint ?? null}
            trackingSettings={trackingSettings}
            trackingResetKey={commandRevision}
            onCursorMove={handleCursorMove}
            grips={gripMarks}
            hotGrip={activeCommand?.name === "GRIPEDIT" ? hotGrip : null}
            onGripClick={handleGripClick}
          />
          {dynamicMode !== null && (
            <DynamicInput
              mode={dynamicMode}
              // 打っている値・確定した値を当てはめた点(ゴム紐・クリックでの指示と同じ点)。表示専用の項目も、これに合わせる
              cursor={applyTypedValues(dynamicMode, activeCommand?.basePoint ?? null, cursorWorld, dynamicLocked, dynamicField, commandText)}
              screen={cursorScreen}
              base={activeCommand?.basePoint ?? null}
              locked={dynamicLocked}
              field={dynamicField}
              typedText={commandText}
              showCursorValues={activeCommand?.expect === "point"}
              area={canvasAreaSize}
            />
          )}
          {activeCommand?.textEditor != null && (
            <TextInputPanel
              key={commandRevision}
              title={activeCommand.prompt}
              multiline={activeCommand.textEditor.multiline}
              initial={activeCommand.textEditor.initial}
              onSubmit={handleTextEditorSubmit}
              onCancel={handleCommandCancel}
            />
          )}
          {layerPanelTab !== null && (
            <LayerManagerPanel
              layers={layers}
              lineTypes={lineStyle.lineTypes}
              ltScale={lineStyle.ltScale}
              currentLayerName={activeLayerName}
              selectedCount={selectedEntityIds.size}
              tab={layerPanelTab}
              onTabChange={setLayerPanelTab}
              onCreate={handleCreateLayer}
              onEdit={handleEditLayer}
              onRename={handleRenameLayer}
              onDelete={handleDeleteLayer}
              onMoveSelected={handleMoveSelectedToLayer}
              onSetLtScale={handleSetLtScale}
              onSetLocked={handleSetLayerLocked}
              onClose={() => setLayerPanelTab(null)}
            />
          )}
          {showGroups && (
            <GroupPanel
              groups={groups}
              pickStyle={pickStyle}
              onSelect={handleSelectGroup}
              onRename={handleRenameGroup}
              onUngroup={handleUngroupFromPanel}
              onTogglePickStyle={handleTogglePickStyle}
              onClose={() => setShowGroups(false)}
            />
          )}
          {showTextStyles && <TextStylePanel table={textStyles} onChange={setTextStyles} onClose={() => setShowTextStyles(false)} />}
          {showDimensionStyles && (
            <DimensionStylePanel table={dimensionStyles} layerNames={layers.map((layer) => layer.name)} onChange={setDimensionStyles} onClose={() => setShowDimensionStyles(false)} />
          )}
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
            <PropertyPanel
              entities={selectedEntities}
              editor={
                isDocumentEditable && loadingProgress === null
                  ? {
                      editable: selectedEntities.filter((entity) => editabilityState.isEditable(entity.id) && !lockedLayerNames.has(entity.layer)),
                      layers,
                      lineTypes: lineStyle.lineTypes,
                      onSetStyle: handleSetStyleProperty,
                      onSetGeometry: handleSetGeometryProperty,
                      onMoveToLayer: handleMoveSelectedToLayer,
                    }
                  : undefined
              }
            />
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
        onTab={handleCommandTab}
        onTextChange={handleCommandTextChange}
        onUndoShortcut={handleCommandLineUndoShortcut}
        resetKey={commandRevision}
      />
      <StatusBar
        fileInfo={fileInfo}
        cursorWorld={cursorWorld}
        stats={cadModel?.stats ?? null}
        isDirty={sessionState.isDirty}
        currentLayerName={activeLayerName}
        snapSettings={snapSettings}
        onToggleSnap={handleToggleSnap}
        onChangeSnapSettings={setSnapSettings}
        trackingSettings={trackingSettings}
        onToggleTracking={handleToggleTracking}
        onChangeTrackingSettings={setTrackingSettings}
      />
      {loadingProgress && loadStartedAt !== null && (
        <LoadingOverlay stage={loadingProgress.stage} entityCount={loadingProgress.entityCount} startedAt={loadStartedAt} />
      )}
    </div>
  );
}
