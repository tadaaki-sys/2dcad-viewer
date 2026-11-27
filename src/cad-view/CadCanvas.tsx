import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CadLayer, CadModel, Measurement, Point2D } from "../types/cad";
import { Camera } from "../core/view/Camera";
import { CanvasRenderer } from "./renderer/CanvasRenderer";
import type { DragSelectionBox, Renderer } from "./renderer/Renderer";
import { findEntitiesInBox, findEntitiesNearPoint } from "../core/selection/Selection";
import type { SnapCandidate } from "../core/snap/SnapEngine";
import { ObjectTrackingAcquirer } from "../core/tracking/acquisition";
import { resolveCursor } from "../core/tracking/resolveCursor";
import type { CursorResolution } from "../core/tracking/resolveCursor";
import type { TrackingGuide } from "../core/tracking/trackingGeometry";
import type { TrackingSettings } from "../core/tracking/trackingSettings";
import type { TrackingLabel } from "./renderer/trackingRender";
import { enabledSnapTypes } from "../core/snap/snapSettings";
import type { SnapSettings } from "../core/snap/snapSettings";
import type { SnapMarker } from "./renderer/snapMarker";
import { findMeasurementAtPoint } from "../core/measurement/Measurement";
import { buildSpatialIndex } from "../core/spatial/SpatialIndex";
import { unionOfVisibleEntityBounds } from "../core/spatial/entityBounds";
import { isTypingTarget } from "../utils/dom";
import type { PreviewShape } from "../core/commands";
import { findGripAt } from "./renderer/gripRender";
import type { GripMark } from "./renderer/gripRender";

const MIDDLE_MOUSE_BUTTON = 1;
const LEFT_MOUSE_BUTTON = 0;
const WHEEL_ZOOM_INTENSITY = 0.0015;
const SELECTION_TOLERANCE_PX = 6;
const DRAG_THRESHOLD_PX = 4;
const SAME_SPOT_TOLERANCE_PX = 3;
const SNAP_TOLERANCE_PX = 10;
// 測定時、線からこの距離(図面の単位=mm)以内なら、線の上の最も近い点へ吸い付く
const NEAREST_SNAP_DISTANCE_WORLD = 5;
// 延長の Snap の対象にする、端点とカーソルの最大距離(画面上のpx)
const EXTENSION_ACQUIRE_PX = 150;

type OverlapCycleState = {
  screenPoint: Point2D;
  candidateIds: string[];
  index: number;
};

function idsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export type CadCanvasPerformanceStats = {
  renderMs: number;
  fps: number | null;
  lastSelectionMs: number | null;
};

export type CadCanvasHandle = {
  fitToDrawing: () => void;
  getPerformanceStats: () => CadCanvasPerformanceStats;
};

const FPS_IDLE_GAP_MS = 500;

type CadCanvasProps = {
  model: CadModel | null;
  /** 開いた図面ごとの番号。変わったときだけ全体表示する(編集・Undoでモデルが変わっても、表示位置は動かさない) */
  drawingKey: number;
  layers: CadLayer[];
  selectedEntityIds: ReadonlySet<string>;
  selectionEnabled: boolean;
  measurementModeEnabled: boolean;
  /** コマンドが点の指示を待っている間 true。クリックは選択・測定より先に、コマンドへ渡す(測定と同じ吸着を使う) */
  pointPickEnabled: boolean;
  /** true なら、点の指示のクリックを、吸着・トラッキングせず、そのままの位置で渡す(TRIM・EXTEND のように、図形を指す操作用) */
  pointPickRaw?: boolean;
  measurements: readonly Measurement[];
  selectedMeasurementId: string | null;
  onSelectionChange: (entityIds: ReadonlySet<string>) => void;
  onMeasurementComplete: (measurement: Measurement) => void;
  onMeasurementSelect: (measurementId: string | null) => void;
  /** 点が指示された。pickToleranceWorld は、図形を指すときの許容距離(図面上の長さ。画面の拡大率による) */
  onPointPick: (worldPoint: Point2D, pickToleranceWorld: number) => void;
  /** 点の指示を待っているコマンドの、ゴム紐(カーソル位置に応じた仮の図形)を返す。無ければ出さない */
  getPreview?: (worldPoint: Point2D) => readonly PreviewShape[];
  /** コマンドの状態が変わるたびに増える番号。変わったら、いまのカーソル位置でゴム紐を作り直す */
  previewRevision?: number;
  /** Snap の設定(OSNAP・種類ごとのオン・オフ・グリッド) */
  snapSettings: SnapSettings;
  /** 垂線・接線・ORTHO・極トラッキングの基準の点(作図中の直前の点など)。無ければ null */
  snapFromPoint?: Point2D | null;
  /** トラッキングの設定(ORTHO・POLAR・OTRACK、角度の刻み、間隔) */
  trackingSettings: TrackingSettings;
  /** 値が変わったら、OTRACK で取得した点を捨てる(コマンドの状態が進んだとき: 点の指示・コマンドの終了など) */
  trackingResetKey?: number;
  /** カーソルの位置(図面上の点は吸着後)。screenPoint は、キャンバスの左上からのピクセル位置(カーソル付近の表示用) */
  onCursorMove?: (worldPoint: Point2D | null, screenPoint: Point2D | null) => void;
  /** グリップ(選択した図形のつかむ点)。コマンドの最中・測定中などは、空にする。クリックすると onGripClick が呼ばれ、選択の操作は始まらない */
  grips?: readonly GripMark[];
  /** ホット(動かしている最中)のグリップ。赤で描く */
  hotGrip?: GripMark | null;
  onGripClick?: (grip: GripMark) => void;
};

function resizeCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLDivElement,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth, clientHeight } = container;
  canvas.width = clientWidth * dpr;
  canvas.height = clientHeight * dpr;
  canvas.style.width = `${clientWidth}px`;
  canvas.style.height = `${clientHeight}px`;
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function getCanvasRelativePoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point2D {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export const CadCanvas = forwardRef<CadCanvasHandle, CadCanvasProps>(function CadCanvas(
  {
    model,
    drawingKey,
    layers,
    selectedEntityIds,
    selectionEnabled,
    measurementModeEnabled,
    pointPickEnabled,
    pointPickRaw,
    measurements,
    selectedMeasurementId,
    onSelectionChange,
    onMeasurementComplete,
    onMeasurementSelect,
    onPointPick,
    getPreview,
    previewRevision,
    snapSettings,
    snapFromPoint = null,
    trackingSettings,
    trackingResetKey = 0,
    onCursorMove,
    grips,
    hotGrip = null,
    onGripClick,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(new Camera());
  const rendererRef = useRef<Renderer>(new CanvasRenderer());
  const dragSelectionBoxRef = useRef<DragSelectionBox | null>(null);
  const overlapCycleRef = useRef<OverlapCycleState | null>(null);
  const pendingMeasurementPointRef = useRef<Point2D | null>(null);
  const snapMarkerRef = useRef<SnapMarker | null>(null);
  // カーソルが乗っているグリップの名前(強調して描く)
  const hoverGripKeyRef = useRef<string | null>(null);
  // 作図中のゴム紐と、そのもとになったカーソル位置(図面上。吸着後)
  const previewRef = useRef<readonly PreviewShape[]>([]);
  const lastPointerWorldRef = useRef<Point2D | null>(null);
  // マウスの、画面上の最後の位置(キャンバスの上にあるとき)。Snap の設定が変わったときに、同じ位置で作り直すため
  const lastClientPointRef = useRef<{ x: number; y: number } | null>(null);
  const refreshAtPointerRef = useRef<(() => void) | null>(null);
  // トラッキング: 一時補助線、説明、OTRACK で取得した点、取得のためのとどめ時間の計測
  const trackingGuidesRef = useRef<readonly TrackingGuide[]>([]);
  const trackingLabelRef = useRef<TrackingLabel | null>(null);
  // OTRACK の取得点の管理(吸着点の上にカーソルをとどめると取得。時間の計測は window.setTimeout)。取得点が変わったら、再描画して、いまのカーソル位置で作り直す
  const [acquirer] = useState(
    () =>
      new ObjectTrackingAcquirer(
        { setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs), clearTimeout: (handle) => window.clearTimeout(handle as number) },
        () => {
          requestDraw();
          refreshAtPointerRef.current?.();
        },
      ),
  );
  const perfRef = useRef<CadCanvasPerformanceStats & { lastDrawAt: number }>({
    renderMs: 0,
    fps: null,
    lastSelectionMs: null,
    lastDrawAt: 0,
  });

  const visibleLayerNames = useMemo(
    () => new Set(layers.filter((layer) => layer.visible).map((layer) => layer.name)),
    [layers],
  );

  // 図面を読み込んだ時に1回だけ作る。選択・スナップ・描画が全図形の総当たりにならないようにするための索引。
  const spatialIndex = useMemo(() => (model ? buildSpatialIndex(model) : null), [model]);

  // 有効な Snap の種類(設定から求める。設定が変わったときだけ作り直す)
  const snapEnabledTypes = useMemo(() => enabledSnapTypes(snapSettings), [snapSettings]);

  const stateRef = useRef({
    snapEnabledTypes,
    model,
    spatialIndex,
    visibleLayerNames,
    selectedEntityIds,
    selectionEnabled,
    measurementModeEnabled,
    pointPickEnabled,
    pointPickRaw,
    measurements,
    selectedMeasurementId,
    onSelectionChange,
    onMeasurementComplete,
    onMeasurementSelect,
    onPointPick,
    getPreview,
    snapSettings,
    snapFromPoint,
    trackingSettings,
    onCursorMove,
    grips,
    hotGrip,
    onGripClick,
  });
  stateRef.current = {
    snapEnabledTypes,
    model,
    spatialIndex,
    visibleLayerNames,
    selectedEntityIds,
    selectionEnabled,
    measurementModeEnabled,
    pointPickEnabled,
    pointPickRaw,
    measurements,
    selectedMeasurementId,
    onSelectionChange,
    onMeasurementComplete,
    onMeasurementSelect,
    onPointPick,
    getPreview,
    snapSettings,
    snapFromPoint,
    trackingSettings,
    onCursorMove,
    grips,
    hotGrip,
    onGripClick,
  };

  function draw() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const renderStart = performance.now();
    const ctx = resizeCanvasToContainer(canvas, container);
    if (!ctx) return;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, container.clientWidth, container.clientHeight);

    const {
      model: currentModel,
      spatialIndex: currentSpatialIndex,
      visibleLayerNames: currentVisible,
      selectedEntityIds: currentSelectedIds,
      measurements: currentMeasurements,
      selectedMeasurementId: currentSelectedMeasurementId,
    } = stateRef.current;
    if (!currentModel) return;

    rendererRef.current.render({
      ctx,
      viewportWidth: container.clientWidth,
      viewportHeight: container.clientHeight,
      model: currentModel,
      camera: cameraRef.current,
      visibleLayerNames: currentVisible,
      selectedEntityIds: currentSelectedIds,
      dragSelectionBox: dragSelectionBoxRef.current,
      measurements: currentMeasurements,
      selectedMeasurementId: currentSelectedMeasurementId,
      pendingMeasurementPoint: pendingMeasurementPointRef.current,
      snapMarker: snapMarkerRef.current,
      gridSpacing: stateRef.current.snapSettings.gridDisplay ? stateRef.current.snapSettings.gridSpacing : null,
      trackingGuides: trackingGuidesRef.current,
      acquiredPoints: acquirer.points,
      trackingLabel: trackingLabelRef.current,
      previewShapes: previewRef.current,
      spatialIndex: currentSpatialIndex,
      grips: stateRef.current.grips,
      hoverGripKey: hoverGripKeyRef.current,
      hotGrip: stateRef.current.hotGrip,
    });

    const renderEnd = performance.now();
    const perf = perfRef.current;
    const delta = perf.lastDrawAt > 0 ? renderEnd - perf.lastDrawAt : Infinity;
    perf.renderMs = renderEnd - renderStart;
    perf.fps = delta < FPS_IDLE_GAP_MS ? 1000 / delta : null;
    perf.lastDrawAt = renderEnd;
  }

  const rafIdRef = useRef<number | null>(null);

  // Pan/Zoom/ドラッグ選択などマウス移動に連動する高頻度描画は、
  // 1フレームに1回へ間引く(大規模DXFでのPan/Zoom FPS低下対策。実測に基づく最小限の最適化)
  function requestDraw() {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      draw();
    });
  }

  function fitToModel() {
    const container = containerRef.current;
    const currentModel = stateRef.current.model;
    if (!container || !currentModel) return;
    // 表示中のレイヤーの図形だけで範囲を決める(非表示の図形が遠くにあっても、見えている図面が小さくならない)。
    // 表示中の図形が無いときは、図面全体の範囲にする。
    const bounds =
      unionOfVisibleEntityBounds(currentModel.entities, currentModel.entityBounds, stateRef.current.visibleLayerNames) ??
      currentModel.bounds;
    if (bounds) cameraRef.current.fit(bounds, container.clientWidth, container.clientHeight);
  }

  useImperativeHandle(ref, () => ({
    fitToDrawing() {
      fitToModel();
      draw();
    },
    getPerformanceStats() {
      const { renderMs, fps, lastSelectionMs } = perfRef.current;
      return { renderMs, fps, lastSelectionMs };
    },
  }));

  const fittedDrawingKeyRef = useRef<number | null>(null);

  useEffect(() => {
    // 新しい図面が読み込まれた時のみ再Fitする(レイヤー表示切替・編集・Undoでは現在の表示範囲を維持する)
    const isNewDrawing = fittedDrawingKeyRef.current !== drawingKey;
    fittedDrawingKeyRef.current = drawingKey;
    if (isNewDrawing) {
      fitToModel();
      pendingMeasurementPointRef.current = null;
      snapMarkerRef.current = null;
    }
    draw();
    overlapCycleRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, drawingKey]);

  useEffect(() => {
    overlapCycleRef.current = null;
  }, [selectionEnabled]);

  useEffect(() => {
    if (!measurementModeEnabled) {
      pendingMeasurementPointRef.current = null;
      snapMarkerRef.current = null;
      draw();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurementModeEnabled]);

  useEffect(() => {
    // コマンドの状態が変わったとき(点を指示した、キーワードを入力した、コマンドが終わった)は、
    // いまのカーソル位置でゴム紐を作り直す。点を待っていなければ消す
    // (点を待っていないときは、古いカーソル位置を捨てる。次のコマンドで、古い位置へのゴム紐が出ないように)
    if (!pointPickEnabled) lastPointerWorldRef.current = null;
    const last = lastPointerWorldRef.current;
    previewRef.current = pointPickEnabled && last !== null ? (stateRef.current.getPreview?.(last) ?? []) : [];
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewRevision, pointPickEnabled]);

  useEffect(() => {
    // 点の指示が終わったとき、測定モードでなければ吸着の目印を消す
    if (!pointPickEnabled && !stateRef.current.measurementModeEnabled) {
      snapMarkerRef.current = null;
      draw();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointPickEnabled]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurements, selectedMeasurementId]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLayerNames]);

  // ---- トラッキング(OTRACK の取得点、一時補助線) ----

  /** 一時補助線と説明を、いまの結果に合わせる(トラッキングで揃えていなければ、消す) */
  function setTrackingVisuals(resolution: CursorResolution | null) {
    const guides = resolution?.tracking?.guides ?? [];
    const text = resolution?.tracking?.label ?? null;
    const label = resolution !== null && text !== null ? { point: resolution.point, text } : null;
    const changed =
      guides.length > 0 || trackingGuidesRef.current.length > 0 || label !== null || trackingLabelRef.current !== null;
    trackingGuidesRef.current = guides;
    trackingLabelRef.current = label;
    if (changed) requestDraw();
  }

  // 画面を閉じるとき、とどめ時間の計測を止める(古いタイマーが、あとから動かないように)
  useEffect(() => () => acquirer.clearDwell(), [acquirer]);

  // コマンドの状態が進んだとき(点の指示・コマンドの終了など)は、取得した点を捨てる
  useEffect(() => {
    acquirer.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingResetKey]);

  // 点の指示も測定もしていないときは、取得した点・補助線を捨てる
  useEffect(() => {
    if (!pointPickEnabled && !measurementModeEnabled) {
      acquirer.clear();
      setTrackingVisuals(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointPickEnabled, measurementModeEnabled]);

  // トラッキングの設定が変わったら、(OTRACK がオフなら)取得した点を捨てて、いまのカーソル位置で作り直す
  useEffect(() => {
    if (!trackingSettings.objectTracking) acquirer.clear();
    refreshAtPointerRef.current?.();
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingSettings]);

  // Snap の設定が変わったら、古い目印を捨てて、いまのカーソル位置で吸着・ゴム紐・座標表示を作り直し、格子の表示も更新する
  useEffect(() => {
    snapMarkerRef.current = null;
    refreshAtPointerRef.current?.();
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapSettings]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntityIds]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Pan/Zoom操作でユーザーが調整した表示範囲を、パネル幅変更等のリサイズでは維持する(再Fitしない)
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const cursorPoint = getCanvasRelativePoint(canvas!, event.clientX, event.clientY);
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_INTENSITY);
      cameraRef.current.zoomAt(cursorPoint, factor);
      requestDraw();
    }

    let cursorRafId: number | null = null;
    let pendingCursorPoint: Point2D | null | undefined;
    let pendingCursorScreen: Point2D | null = null;

    // カーソル座標コールバック(StatusBar表示用)もPan中は毎mousemoveごとのReact再描画を招くため、
    // 描画と同様に1フレームに1回へ間引く(実測に基づく最小限の最適化)
    function scheduleCursorUpdate(point: Point2D | null, screenPoint: Point2D | null = null) {
      pendingCursorPoint = point;
      pendingCursorScreen = screenPoint;
      if (cursorRafId !== null) return;
      cursorRafId = requestAnimationFrame(() => {
        cursorRafId = null;
        if (pendingCursorPoint !== undefined) {
          stateRef.current.onCursorMove?.(pendingCursorPoint, pendingCursorScreen);
        }
      });
    }

    let isPanning = false;
    let lastPanPoint: Point2D | null = null;
    let isSpaceHeld = false;

    let leftDragStartClient: Point2D | null = null;
    let isBoxDragging = false;

    // Space押下中は掴んで移動できることが分かるようカーソルを手のひらアイコンに変える(中ボタンドラッグが分かりにくいための代替操作)
    function updatePanCursor() {
      canvas!.style.cursor = isPanning ? "grabbing" : isSpaceHeld ? "grab" : "";
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || isSpaceHeld || isTypingTarget(event.target)) return;
      isSpaceHeld = true;
      event.preventDefault();
      updatePanCursor();
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code !== "Space") return;
      isSpaceHeld = false;
      updatePanCursor();
    }

    function handleWindowBlur() {
      isSpaceHeld = false;
      isPanning = false;
      lastPanPoint = null;
      updatePanCursor();
    }

    /** マウスの位置から、決まった点(吸着・トラッキング・近接・グリッド)を求める */
    function findSnapAt(clientX: number, clientY: number): { worldPoint: Point2D } & CursorResolution {
      const screenPoint = getCanvasRelativePoint(canvas!, clientX, clientY);
      const worldPoint = cameraRef.current.screenToWorld(screenPoint);
      const {
        model: currentModel,
        visibleLayerNames: currentVisible,
        measurementModeEnabled: currentMeasurementModeEnabled,
        pointPickEnabled: currentPointPickEnabled,
      } = stateRef.current;
      // 吸着は、測定中と、コマンドが点の指示を待っている間だけ。図形を指す操作(pointPickRaw)の間は、測定中でも、吸着しない
      // (点の指示は、測定より先に、クリックをコマンドが受け取るため)
      if (!(currentMeasurementModeEnabled || currentPointPickEnabled) || !currentModel || (stateRef.current.pointPickRaw === true && currentPointPickEnabled)) {
        return { worldPoint, point: worldPoint, snap: null, tracking: null, acquirable: null };
      }

      const scale = cameraRef.current.scale;
      const { snapSettings: settings, snapEnabledTypes: enabledTypes } = stateRef.current;
      // 垂線・接線・ORTHO・極トラッキングの基準: 測定中は、1点目。作図中は、コマンドの段階が持つ基準点
      const base = currentMeasurementModeEnabled ? pendingMeasurementPointRef.current : stateRef.current.snapFromPoint;
      const resolution = resolveCursor({
        entities: currentModel.entities,
        visibleLayerNames: currentVisible,
        worldPoint,
        toleranceWorld: SNAP_TOLERANCE_PX / scale,
        index: stateRef.current.spatialIndex,
        snapOptions: {
          // 線の近く(図面上5mm以内、または画面上の吸着距離以内のどちらか広い方)なら、線の上の最も近い点へ吸い付く
          nearestToleranceWorld: Math.max(NEAREST_SNAP_DISTANCE_WORLD, SNAP_TOLERANCE_PX / scale),
          enabledTypes,
          gridSpacing: settings.gridSpacing,
          extensionAcquireWorld: EXTENSION_ACQUIRE_PX / scale,
        },
        base,
        tracking: stateRef.current.trackingSettings,
        acquired: acquirer.points,
      });
      return { worldPoint, ...resolution };
    }

    function computeWorldPointWithSnap(clientX: number, clientY: number): Point2D {
      return findSnapAt(clientX, clientY).point;
    }

    function handleMeasurementClick(event: MouseEvent) {
      const point = computeWorldPointWithSnap(event.clientX, event.clientY);
      const pendingPoint = pendingMeasurementPointRef.current;
      // 測定の点を確定するたびに、取得した点を捨てる(測定は、コマンドの状態(trackingResetKey)が変わらないので、ここで捨てる)
      acquirer.clear();
      if (pendingPoint === null) {
        pendingMeasurementPointRef.current = point;
      } else {
        pendingMeasurementPointRef.current = null;
        stateRef.current.onMeasurementComplete({
          id: crypto.randomUUID(),
          pointA: pendingPoint,
          pointB: point,
        });
      }
      draw();
    }

    function applySingleClickSelection(event: MouseEvent) {
      const { model: currentModel, visibleLayerNames: currentVisible, selectedEntityIds: currentSelected, measurements: currentMeasurements } =
        stateRef.current;

      const screenPoint = getCanvasRelativePoint(canvas!, event.clientX, event.clientY);
      const worldPoint = cameraRef.current.screenToWorld(screenPoint);
      const toleranceWorld = SELECTION_TOLERANCE_PX / cameraRef.current.scale;

      if (event.ctrlKey || event.metaKey) {
        stateRef.current.onMeasurementSelect(null);
        if (!currentModel) return;
        const candidates = findEntitiesNearPoint(
          currentModel.entities,
          currentVisible,
          worldPoint,
          toleranceWorld,
          stateRef.current.spatialIndex,
        );
        overlapCycleRef.current = null; // Ctrl+Clickは巡回選択とは独立した操作として扱う
        const hitEntity = candidates[0] ?? null;
        if (!hitEntity) return; // Ctrl+空白クリックは選択状態を変えない
        const next = new Set(currentSelected);
        if (next.has(hitEntity.id)) {
          next.delete(hitEntity.id);
        } else {
          next.add(hitEntity.id);
        }
        stateRef.current.onSelectionChange(next);
        return;
      }

      // Entity選択より先に、Measurement Overlayへのヒットを優先判定する
      const hitMeasurement = findMeasurementAtPoint(currentMeasurements, worldPoint, toleranceWorld);
      if (hitMeasurement) {
        overlapCycleRef.current = null;
        stateRef.current.onSelectionChange(new Set());
        stateRef.current.onMeasurementSelect(hitMeasurement.id);
        return;
      }
      stateRef.current.onMeasurementSelect(null);

      if (!currentModel) {
        stateRef.current.onSelectionChange(new Set());
        return;
      }
      const candidates = findEntitiesNearPoint(
        currentModel.entities,
        currentVisible,
        worldPoint,
        toleranceWorld,
        stateRef.current.spatialIndex,
      );

      if (candidates.length === 0) {
        overlapCycleRef.current = null;
        stateRef.current.onSelectionChange(new Set());
        return;
      }

      const candidateIds = candidates.map((entity) => entity.id);
      const previous = overlapCycleRef.current;
      const isSameSpotAsLastClick =
        previous !== null &&
        Math.hypot(screenPoint.x - previous.screenPoint.x, screenPoint.y - previous.screenPoint.y) <=
          SAME_SPOT_TOLERANCE_PX &&
        idsEqual(previous.candidateIds, candidateIds);

      const nextIndex = isSameSpotAsLastClick ? (previous!.index + 1) % candidates.length : 0;
      overlapCycleRef.current = { screenPoint, candidateIds, index: nextIndex };
      stateRef.current.onSelectionChange(new Set([candidateIds[nextIndex]]));
    }

    function applyBoxSelection(event: MouseEvent) {
      if (!leftDragStartClient) return;
      overlapCycleRef.current = null;
      stateRef.current.onMeasurementSelect(null);
      const { model: currentModel, visibleLayerNames: currentVisible, selectedEntityIds: currentSelected } =
        stateRef.current;
      if (!currentModel) return;

      const startScreen = getCanvasRelativePoint(canvas!, leftDragStartClient.x, leftDragStartClient.y);
      const endScreen = getCanvasRelativePoint(canvas!, event.clientX, event.clientY);
      const startWorld = cameraRef.current.screenToWorld(startScreen);
      const endWorld = cameraRef.current.screenToWorld(endScreen);

      const box = {
        min: { x: Math.min(startWorld.x, endWorld.x), y: Math.min(startWorld.y, endWorld.y) },
        max: { x: Math.max(startWorld.x, endWorld.x), y: Math.max(startWorld.y, endWorld.y) },
      };
      const mode = startScreen.x <= endScreen.x ? "window" : "crossing";
      const hitEntities = findEntitiesInBox(currentModel.entities, currentVisible, box, mode, stateRef.current.spatialIndex);
      const hitIds = hitEntities.map((entity) => entity.id);

      if (event.ctrlKey || event.metaKey) {
        stateRef.current.onSelectionChange(new Set([...currentSelected, ...hitIds]));
      } else {
        stateRef.current.onSelectionChange(new Set(hitIds));
      }
    }

    function handleMouseDown(event: MouseEvent) {
      if (event.button === MIDDLE_MOUSE_BUTTON || (event.button === LEFT_MOUSE_BUTTON && isSpaceHeld)) {
        event.preventDefault();
        isPanning = true;
        lastPanPoint = { x: event.clientX, y: event.clientY };
        updatePanCursor();
        return;
      }
      // グリップをクリックしたら、そのグリップを動かすコマンドを始める(選択の操作は始めない)。グリップは、コマンド・測定の最中は、出ない
      if (event.button === LEFT_MOUSE_BUTTON && !stateRef.current.pointPickEnabled && !stateRef.current.measurementModeEnabled) {
        const gripList = stateRef.current.grips;
        if (gripList !== undefined && gripList.length > 0 && stateRef.current.onGripClick !== undefined) {
          const hit = findGripAt(gripList, cameraRef.current, getCanvasRelativePoint(canvas!, event.clientX, event.clientY));
          if (hit !== null) {
            event.preventDefault();
            hoverGripKeyRef.current = null;
            stateRef.current.onGripClick(hit);
            return;
          }
        }
      }
      // コマンドが点の指示を待っているときは、クリックをコマンドへ渡す(測定・選択より優先)
      if (event.button === LEFT_MOUSE_BUTTON && stateRef.current.pointPickEnabled) {
        event.preventDefault();
        stateRef.current.onPointPick(computeWorldPointWithSnap(event.clientX, event.clientY), SELECTION_TOLERANCE_PX / cameraRef.current.scale);
        return;
      }
      if (event.button === LEFT_MOUSE_BUTTON && stateRef.current.measurementModeEnabled) {
        handleMeasurementClick(event);
        return;
      }
      if (event.button === LEFT_MOUSE_BUTTON && stateRef.current.selectionEnabled) {
        leftDragStartClient = { x: event.clientX, y: event.clientY };
        isBoxDragging = false;
      }
    }

    function handleWindowMouseMove(event: MouseEvent) {
      if (isPanning && lastPanPoint) {
        const dx = event.clientX - lastPanPoint.x;
        const dy = event.clientY - lastPanPoint.y;
        lastPanPoint = { x: event.clientX, y: event.clientY };
        cameraRef.current.pan(dx, dy);
        requestDraw();
        return;
      }

      if (leftDragStartClient) {
        const dx = event.clientX - leftDragStartClient.x;
        const dy = event.clientY - leftDragStartClient.y;
        if (!isBoxDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          isBoxDragging = true;
        }
        if (isBoxDragging) {
          const startScreen = getCanvasRelativePoint(canvas!, leftDragStartClient.x, leftDragStartClient.y);
          const currentScreen = getCanvasRelativePoint(canvas!, event.clientX, event.clientY);
          dragSelectionBoxRef.current = {
            screenMin: {
              x: Math.min(startScreen.x, currentScreen.x),
              y: Math.min(startScreen.y, currentScreen.y),
            },
            screenMax: {
              x: Math.max(startScreen.x, currentScreen.x),
              y: Math.max(startScreen.y, currentScreen.y),
            },
            mode: startScreen.x <= currentScreen.x ? "window" : "crossing",
          };
          requestDraw();
        }
      }
    }

    function handleWindowMouseUp(event: MouseEvent) {
      if (event.button === MIDDLE_MOUSE_BUTTON || (event.button === LEFT_MOUSE_BUTTON && isPanning)) {
        isPanning = false;
        lastPanPoint = null;
        updatePanCursor();
        return;
      }
      if (event.button === LEFT_MOUSE_BUTTON && leftDragStartClient) {
        const selectionStart = performance.now();
        if (isBoxDragging) {
          applyBoxSelection(event);
        } else {
          applySingleClickSelection(event);
        }
        perfRef.current.lastSelectionMs = performance.now() - selectionStart;
        leftDragStartClient = null;
        isBoxDragging = false;
        dragSelectionBoxRef.current = null;
        draw();
      }
    }

    // 吸着先の目印。測定モード中のホバーで、吸い付いた位置が分かるように表示する
    function updateSnapMarker(candidate: SnapCandidate | null) {
      const previous = snapMarkerRef.current;
      if (previous === null && candidate === null) return;
      if (
        previous &&
        candidate &&
        previous.type === candidate.type &&
        previous.point.x === candidate.point.x &&
        previous.point.y === candidate.point.y
      ) {
        return;
      }
      snapMarkerRef.current = candidate ? { point: candidate.point, type: candidate.type } : null;
      requestDraw();
    }

    /** カーソル(画面の位置)に対する、吸着・目印・ゴム紐・座標表示を更新する */
    function applyPointer(clientX: number, clientY: number) {
      // グリップの上にカーソルがあれば、強調する(グリップが無いときは、何もしない)
      const gripList = stateRef.current.grips;
      const hoverKey =
        gripList !== undefined && gripList.length > 0 && !isPanning && !stateRef.current.pointPickEnabled
          ? (findGripAt(gripList, cameraRef.current, getCanvasRelativePoint(canvas!, clientX, clientY))?.key ?? null)
          : null;
      if (hoverKey !== hoverGripKeyRef.current) {
        hoverGripKeyRef.current = hoverKey;
        requestDraw();
      }
      if (!stateRef.current.measurementModeEnabled && !stateRef.current.pointPickEnabled) {
        updateSnapMarker(null);
        setTrackingVisuals(null);
        acquirer.clearDwell();
        if (!stateRef.current.onCursorMove) return;
        scheduleCursorUpdate(computeWorldPointWithSnap(clientX, clientY), getCanvasRelativePoint(canvas!, clientX, clientY));
        return;
      }
      const resolution = findSnapAt(clientX, clientY);
      updateSnapMarker(isPanning ? null : resolution.snap);
      setTrackingVisuals(isPanning ? null : resolution);
      // OTRACK がオンで、パン中でなければ、取得できる吸着点の上に、カーソルがあるかを渡す(とどめ時間の計測は、acquirer が行う)
      acquirer.update(isPanning || !stateRef.current.trackingSettings.objectTracking ? null : (resolution.acquirable?.point ?? null));
      if (stateRef.current.pointPickEnabled) {
        // 作図中: カーソルの位置(吸着・トラッキング後)に応じて、ゴム紐を作る(図面のデータは変えず、重ねて描くだけ)
        const cursor = resolution.point;
        lastPointerWorldRef.current = cursor;
        previewRef.current = stateRef.current.getPreview?.(cursor) ?? [];
        requestDraw();
      }
      if (stateRef.current.onCursorMove) {
        scheduleCursorUpdate(resolution.point, getCanvasRelativePoint(canvas!, clientX, clientY));
      }
    }

    function handleMouseMove(event: MouseEvent) {
      lastClientPointRef.current = { x: event.clientX, y: event.clientY };
      applyPointer(event.clientX, event.clientY);
    }

    // Snap の設定が変わったとき(マウスは動いていない)に、いまのカーソル位置で、吸着・ゴム紐・座標表示を作り直す
    refreshAtPointerRef.current = () => {
      const point = lastClientPointRef.current;
      if (point !== null) applyPointer(point.x, point.y);
    };

    function handleMouseLeave() {
      lastClientPointRef.current = null;
      updateSnapMarker(null);
      setTrackingVisuals(null);
      acquirer.clearDwell();
      if (previewRef.current.length > 0) {
        previewRef.current = [];
        requestDraw();
      }
      lastPointerWorldRef.current = null;
      scheduleCursorUpdate(null);
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      refreshAtPointerRef.current = null;
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
    // 画面の状態は stateRef と ref から読む(このイベントの登録は、最初の1回だけ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} />
    </div>
  );
});
