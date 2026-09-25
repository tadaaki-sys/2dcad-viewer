import { useCallback, useRef, useState } from "react";
import "./ResizablePanel.css";

type ResizablePanelProps = {
  side: "left" | "right";
  width: number;
  minWidth?: number;
  maxWidth?: number;
  collapsed: boolean;
  onWidthChange: (width: number) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
};

export function ResizablePanel({
  side,
  width,
  minWidth = 160,
  maxWidth = 480,
  collapsed,
  onWidthChange,
  onCollapsedChange,
  children,
}: ResizablePanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!dragStartRef.current) return;
      const delta = event.clientX - dragStartRef.current.startX;
      const signedDelta = side === "left" ? delta : -delta;
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, dragStartRef.current.startWidth + signedDelta));
      onWidthChange(nextWidth);
    },
    [maxWidth, minWidth, onWidthChange, side],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove]);

  function handlePointerDown(event: React.PointerEvent) {
    dragStartRef.current = { startX: event.clientX, startWidth: width };
    setIsDragging(true);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  const className = [
    "resizable-panel",
    `resizable-panel--${side}`,
    collapsed ? "resizable-panel--collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} style={{ width: collapsed ? undefined : width }}>
      <button
        type="button"
        className="resizable-panel__collapse-toggle"
        onClick={() => onCollapsedChange(!collapsed)}
        title={collapsed ? "パネルを開く" : "パネルを折りたたむ"}
      >
        {side === "left" ? (collapsed ? "▶" : "◀") : collapsed ? "◀" : "▶"}
      </button>
      {side === "right" && (
        <div
          className={`resizable-panel__handle${isDragging ? " resizable-panel__handle--active" : ""}`}
          onPointerDown={handlePointerDown}
        />
      )}
      <div className="resizable-panel__content">{children}</div>
      {side === "left" && (
        <div
          className={`resizable-panel__handle${isDragging ? " resizable-panel__handle--active" : ""}`}
          onPointerDown={handlePointerDown}
        />
      )}
    </div>
  );
}
