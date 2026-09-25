import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { CadCanvasHandle, CadCanvasPerformanceStats } from "../cad-view/CadCanvas";
import "./PerformanceOverlay.css";

const POLL_INTERVAL_MS = 250;

type PerformanceOverlayProps = {
  cadCanvasRef: RefObject<CadCanvasHandle | null>;
  parseTimeMs: number | null;
  entityCount: { total: number; supported: number } | null;
};

function formatMsOrDash(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(1)} ms`;
}

export function PerformanceOverlay({ cadCanvasRef, parseTimeMs, entityCount }: PerformanceOverlayProps) {
  const [stats, setStats] = useState<CadCanvasPerformanceStats>({ renderMs: 0, fps: null, lastSelectionMs: null });

  useEffect(() => {
    const interval = window.setInterval(() => {
      const current = cadCanvasRef.current?.getPerformanceStats();
      if (current) setStats(current);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [cadCanvasRef]);

  return (
    <div className="performance-overlay">
      <div>Parse: {formatMsOrDash(parseTimeMs)}</div>
      <div>Entities: {entityCount ? `${entityCount.supported} / ${entityCount.total}` : "-"}</div>
      <div>Render: {formatMsOrDash(stats.renderMs)}</div>
      <div>FPS: {stats.fps === null ? "-" : stats.fps.toFixed(0)}</div>
      <div>Selection: {formatMsOrDash(stats.lastSelectionMs)}</div>
    </div>
  );
}
