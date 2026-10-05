import { useRef, useState } from "react";
import "./StartScreen.css";

export type RecentFileEntry = {
  fileName: string;
  lastViewedAt: string;
};

type StartScreenProps = {
  recentFiles: RecentFileEntry[];
  errorMessage: string | null;
  onFileSelected: (file: File) => void;
};

export function StartScreen({ recentFiles, errorMessage, onFileSelected }: StartScreenProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave() {
    setIsDragActive(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      onFileSelected(file);
    }
  }

  function handleBrowseClick() {
    fileInputRef.current?.click();
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    event.target.value = "";
  }

  return (
    <div className="start-screen">
      <div
        className={`start-screen__dropzone${isDragActive ? " start-screen__dropzone--active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="start-screen__message">DXF / DWGファイルをここへドロップ</div>
        <div className="start-screen__or">または</div>
        <button type="button" className="start-screen__button" onClick={handleBrowseClick}>
          ファイルを選択
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dxf,.dwg"
          style={{ display: "none" }}
          onChange={handleFileInputChange}
        />
      </div>

      {errorMessage && <div className="start-screen__error">{errorMessage}</div>}

      <div className="start-screen__recent">
        <div className="start-screen__recent-title">最近使ったファイル</div>
        {recentFiles.length === 0 ? (
          <div className="start-screen__recent-empty">まだありません</div>
        ) : (
          <ul className="start-screen__recent-list">
            {recentFiles.map((entry) => (
              <li key={entry.fileName + entry.lastViewedAt}>
                <button
                  type="button"
                  className="start-screen__recent-item"
                  onClick={handleBrowseClick}
                  title="クリックするとファイル選択ダイアログが開きます(同じファイルを選び直してください)"
                >
                  <span>{entry.fileName}</span>
                  <span className="start-screen__recent-item-date">{entry.lastViewedAt}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
