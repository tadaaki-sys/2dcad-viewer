import { useCallback, useEffect, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { LayerPanel } from "./components/LayerPanel";
import { PropertyPanel } from "./components/PropertyPanel";
import { MeasurementPanel } from "./components/MeasurementPanel";
import { StatusBar } from "./components/StatusBar";
import { StartScreen } from "./components/StartScreen";
import { ResizablePanel } from "./components/ResizablePanel";
import { CadCanvas } from "./cad-view/CadCanvas";
import type { CadLayer, DocumentInfo } from "./types/cad";
import "./App.css";

export default function App() {
  const [fileInfo, setFileInfo] = useState<DocumentInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMeasurementMode, setIsMeasurementMode] = useState(false);
  const [layers, setLayers] = useState<CadLayer[]>([]);

  const [leftWidth, setLeftWidth] = useState(200);
  const [rightWidth, setRightWidth] = useState(240);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const isDocumentOpen = fileInfo !== null;

  const handleFileSelected = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith(".dxf")) {
      setErrorMessage(
        "DXFの解析に失敗しました。\n\n考えられる原因：\n・ASCII DXFではない\n・ファイルが破損している\n・未対応形式",
      );
      return;
    }
    setErrorMessage(null);
    setFileInfo({ fileName: file.name, fileSizeBytes: file.size });
    setLayers([]);
  }, []);

  const handleCloseDocument = useCallback(() => {
    setFileInfo(null);
    setLayers([]);
    setIsMeasurementMode(false);
  }, []);

  const handleOpenFileRequest = useCallback(() => {
    // Phase2で実ファイルダイアログに置き換えるまでは開始画面へ戻す暫定動作
    handleCloseDocument();
  }, [handleCloseDocument]);

  const handleToggleMeasurementMode = useCallback(() => {
    setIsMeasurementMode((prev) => !prev);
  }, []);

  const handleFitDrawing = useCallback(() => {
    // Camera実装はPhase5で対応
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
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
  }, [isDocumentOpen, isMeasurementMode, handleFitDrawing, handleToggleMeasurementMode, handleOpenFileRequest]);

  if (!isDocumentOpen) {
    return <StartScreen recentFiles={[]} errorMessage={errorMessage} onFileSelected={handleFileSelected} />;
  }

  return (
    <div className="app-cad-layout">
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
          <CadCanvas />
        </div>

        <ResizablePanel
          side="right"
          width={rightWidth}
          collapsed={rightCollapsed}
          onWidthChange={setRightWidth}
          onCollapsedChange={setRightCollapsed}
        >
          <div className="app-cad-layout__right-content">
            <PropertyPanel />
            <MeasurementPanel />
          </div>
        </ResizablePanel>
      </div>
      <StatusBar fileInfo={fileInfo} cursorWorld={null} />
    </div>
  );
}
