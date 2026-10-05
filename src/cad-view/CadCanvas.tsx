import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { CadLayer, CadModel, Measurement, Point2D } from "../types/cad";
import { Camera } from "./camera/Camera";
import { CanvasRenderer } from "./renderer/CanvasRenderer";
import type { DragSelectionBox, Renderer } from "./renderer/Renderer";
import { findEntitiesInBox, findEntitiesNearPoint } from "./selection/Selection";
import { findSnapPoint } from "./snap/SnapEngine";
import { findMeasurementAtPoint } from "./measurement/Measurement";
import { buildSpatialIndex } from "./spatial/SpatialIndex";

const MIDDLE_MOUSE_BUTTON = 1;
const LEFT_MOUSE_BUTTON = 0;
const WHEEL_ZOOM_INTENSITY = 0.0015;
const SELECTION_TOLERANCE_PX = 6;
const DRAG_THRESHOLD_PX = 4;
const SAME_SPOT_TOLERANCE_PX = 3;
const SNAP_TOLERANCE_PX = 10;

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
  layers: CadLayer[];
  selectedEntityIds: ReadonlySet<string>;
  selectionEnabled: boolean;
  measurementModeEnabled: boolean;
  measurements: readonly Measurement[];
  selectedMeasurementId: string | null;
  onSelectionChange: (entityIds: ReadonlySet<string>) => void;
  onMeasurementComplete: (measurement: Measurement) => void;
  onMeasurementSelect: (measurementId: string | null) => void;
  onCursorMove?: (worldPoint: Point2D | null) => void;
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
    layers,
    selectedEntityIds,
    selectionEnabled,
    measurementModeEnabled,
    measurements,
    selectedMeasurementId,
    onSelectionChange,
    onMeasurementComplete,
    onMeasurementSelect,
    onCursorMove,
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

  const stateRef = useRef({
    model,
    spatialIndex,
    visibleLayerNames,
    selectedEntityIds,
    selectionEnabled,
    measurementModeEnabled,
    measurements,
    selectedMeasurementId,
    onSelectionChange,
    onMeasurementComplete,
    onMeasurementSelect,
    onCursorMove,
  });
  stateRef.current = {
    model,
    spatialIndex,
    visibleLayerNames,
    selectedEntityIds,
    selectionEnabled,
    measurementModeEnabled,
    measurements,
    selectedMeasurementId,
    onSelectionChange,
    onMeasurementComplete,
    onMeasurementSelect,
    onCursorMove,
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
      spatialIndex: currentSpatialIndex,
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
    if (container && currentModel?.bounds) {
      cameraRef.current.fit(currentModel.bounds, container.clientWidth, container.clientHeight);
    }
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

  useEffect(() => {
    fitToModel();
    draw();
    overlapCycleRef.current = null;
    pendingMeasurementPointRef.current = null;
    // 新しい図面が読み込まれた時のみ再Fitする(レイヤー表示切替では現在の表示範囲を維持する)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  useEffect(() => {
    overlapCycleRef.current = null;
  }, [selectionEnabled]);

  useEffect(() => {
    if (!measurementModeEnabled) {
      pendingMeasurementPointRef.current = null;
      draw();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurementModeEnabled]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurements, selectedMeasurementId]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLayerNames]);

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

    // カーソル座標コールバック(StatusBar表示用)もPan中は毎mousemoveごとのReact再描画を招くため、
    // 描画と同様に1フレームに1回へ間引く(実測に基づく最小限の最適化)
    function scheduleCursorUpdate(point: Point2D | null) {
      pendingCursorPoint = point;
      if (cursorRafId !== null) return;
      cursorRafId = requestAnimationFrame(() => {
        cursorRafId = null;
        if (pendingCursorPoint !== undefined) {
          stateRef.current.onCursorMove?.(pendingCursorPoint);
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

    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
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

    function computeWorldPointWithSnap(clientX: number, clientY: number): Point2D {
      const screenPoint = getCanvasRelativePoint(canvas!, clientX, clientY);
      const worldPoint = cameraRef.current.screenToWorld(screenPoint);
      const { model: currentModel, visibleLayerNames: currentVisible, measurementModeEnabled: currentMeasurementModeEnabled } =
        stateRef.current;
      if (currentMeasurementModeEnabled && currentModel) {
        const toleranceWorld = SNAP_TOLERANCE_PX / cameraRef.current.scale;
        const snap = findSnapPoint(currentModel.entities, currentVisible, worldPoint, toleranceWorld, stateRef.current.spatialIndex);
        if (snap) return snap.point;
      }
      return worldPoint;
    }

    function handleMeasurementClick(event: MouseEvent) {
      const point = computeWorldPointWithSnap(event.clientX, event.clientY);
      const pendingPoint = pendingMeasurementPointRef.current;
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

    function handleMouseMove(event: MouseEvent) {
      if (!stateRef.current.onCursorMove) return;
      scheduleCursorUpdate(computeWorldPointWithSnap(event.clientX, event.clientY));
    }

    function handleMouseLeave() {
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
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} />
    </div>
  );
});
