import { useEffect, useState } from "react";
import type { DxfLoadingStage } from "../dxf/dxfWorkerProtocol";
import "./LoadingOverlay.css";

const STAGE_LABELS: Record<DxfLoadingStage, string> = {
  reading: "ファイル読込",
  dwgConverting: "DWG変換",
  parsing: "DXF解析",
  converting: "内部形式変換",
  preparing: "描画準備",
};

const STAGE_PERCENT: Record<DxfLoadingStage, number> = {
  reading: 10,
  dwgConverting: 30,
  parsing: 50,
  converting: 80,
  preparing: 95,
};

type LoadingOverlayProps = {
  stage: DxfLoadingStage;
  entityCount: number | null;
  startedAt: number;
};

export function LoadingOverlay({ stage, entityCount, startedAt }: LoadingOverlayProps) {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  return (
    <div className="loading-overlay">
      <div className="loading-overlay__panel">
        <div className="loading-overlay__stage">現在処理：{STAGE_LABELS[stage]}</div>
        <div className="loading-overlay__bar-track">
          <div className="loading-overlay__bar-fill" style={{ width: `${STAGE_PERCENT[stage]}%` }} />
        </div>
        <div className="loading-overlay__stats">
          <span>Entity数: {entityCount ?? "-"}</span>
          <span>経過時間: {(elapsedMs / 1000).toFixed(1)} s</span>
        </div>
      </div>
    </div>
  );
}
