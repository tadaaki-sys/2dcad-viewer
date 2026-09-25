import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { CadLayer, CadModel, Point2D } from "../types/cad";
import { Camera } from "./camera/Camera";
import { CanvasRenderer } from "./renderer/CanvasRenderer";
import type { DragSelectionBox, Renderer } from "./renderer/Renderer";
import { findEntitiesInBox, findEntityAtPoint } from "./selection/Selection";

const MIDDLE_MOUSE_BUTTON = 1;
const LEFT_MOUSE_BUTTON = 0;
const WHEEL_ZOOM_INTENSITY = 0.0015;
const SELECTION_TOLERANCE_PX = 6;
const DRAG_THRESHOLD_PX = 4;

export type CadCanvasHandle = {
  fitToDrawing: () => void;
};

type CadCanvasProps = {
  model: CadModel | null;
  layers: CadLayer[];
  selectedEntityIds: ReadonlySet<string>;
  selectionEnabled: boolean;
  onSelectionChange: (entityIds: ReadonlySet<string>) => void;
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
  { model, layers, selectedEntityIds, selectionEnabled, onSelectionChange, onCursorMove },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(new Camera());
  const rendererRef = useRef<Renderer>(new CanvasRenderer());
  const dragSelectionBoxRef = useRef<DragSelectionBox | null>(null);

  const visibleLayerNames = useMemo(
    () => new Set(layers.filter((layer) => layer.visible).map((layer) => layer.name)),
    [layers],
  );

  const stateRef = useRef({
    model,
    visibleLayerNames,
    selectedEntityIds,
    selectionEnabled,
    onSelectionChange,
    onCursorMove,
  });
  stateRef.current = { model, visibleLayerNames, selectedEntityIds, selectionEnabled, onSelectionChange, onCursorMove };

  function draw() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = resizeCanvasToContainer(canvas, container);
    if (!ctx) return;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, container.clientWidth, container.clientHeight);

    const { model: currentModel, visibleLayerNames: currentVisible, selectedEntityIds: currentSelectedIds } =
      stateRef.current;
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
  }));

  useEffect(() => {
    fitToModel();
    draw();
    // 新しい図面が読み込まれた時のみ再Fitする(レイヤー表示切替では現在の表示範囲を維持する)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

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
      draw();
    }

    let isPanning = false;
    let lastPanPoint: Point2D | null = null;

    let leftDragStartClient: Point2D | null = null;
    let isBoxDragging = false;

    function applySingleClickSelection(event: MouseEvent) {
      const { model: currentModel, visibleLayerNames: currentVisible, selectedEntityIds: currentSelected } =
        stateRef.current;
      if (!currentModel) return;

      const screenPoint = getCanvasRelativePoint(canvas!, event.clientX, event.clientY);
      const worldPoint = cameraRef.current.screenToWorld(screenPoint);
      const toleranceWorld = SELECTION_TOLERANCE_PX / cameraRef.current.scale;
      const hitEntity = findEntityAtPoint(currentModel.entities, currentVisible, worldPoint, toleranceWorld);

      if (event.ctrlKey || event.metaKey) {
        if (!hitEntity) return; // Ctrl+空白クリックは選択状態を変えない
        const next = new Set(currentSelected);
        if (next.has(hitEntity.id)) {
          next.delete(hitEntity.id);
        } else {
          next.add(hitEntity.id);
        }
        stateRef.current.onSelectionChange(next);
      } else {
        stateRef.current.onSelectionChange(hitEntity ? new Set([hitEntity.id]) : new Set());
      }
    }

    function applyBoxSelection(event: MouseEvent) {
      if (!leftDragStartClient) return;
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
      const hitEntities = findEntitiesInBox(currentModel.entities, currentVisible, box, mode);
      const hitIds = hitEntities.map((entity) => entity.id);

      if (event.ctrlKey || event.metaKey) {
        stateRef.current.onSelectionChange(new Set([...currentSelected, ...hitIds]));
      } else {
        stateRef.current.onSelectionChange(new Set(hitIds));
      }
    }

    function handleMouseDown(event: MouseEvent) {
      if (event.button === MIDDLE_MOUSE_BUTTON) {
        event.preventDefault();
        isPanning = true;
        lastPanPoint = { x: event.clientX, y: event.clientY };
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
        draw();
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
          draw();
        }
      }
    }

    function handleWindowMouseUp(event: MouseEvent) {
      if (event.button === MIDDLE_MOUSE_BUTTON) {
        isPanning = false;
        lastPanPoint = null;
        return;
      }
      if (event.button === LEFT_MOUSE_BUTTON && leftDragStartClient) {
        if (isBoxDragging) {
          applyBoxSelection(event);
        } else {
          applySingleClickSelection(event);
        }
        leftDragStartClient = null;
        isBoxDragging = false;
        dragSelectionBoxRef.current = null;
        draw();
      }
    }

    function handleMouseMove(event: MouseEvent) {
      const { onCursorMove: currentOnCursorMove } = stateRef.current;
      if (!currentOnCursorMove) return;
      const screenPoint = getCanvasRelativePoint(canvas!, event.clientX, event.clientY);
      currentOnCursorMove(cameraRef.current.screenToWorld(screenPoint));
    }

    function handleMouseLeave() {
      stateRef.current.onCursorMove?.(null);
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} />
    </div>
  );
});
