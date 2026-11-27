import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { EditOutcome } from "../app/document/editing";
import type { CadGroup } from "../types/cad";
import "./LayerManagerPanel.css";

type GroupPanelProps = {
  groups: readonly CadGroup[];
  /** グループ単位の選択(PICKSTYLE)がオンか */
  pickStyle: boolean;
  onSelect: (group: CadGroup) => void;
  onRename: (from: string, to: string) => EditOutcome;
  onUngroup: (group: CadGroup) => EditOutcome;
  onTogglePickStyle: () => void;
  onClose: () => void;
};

/**
 * グループの一覧のパネル(GROUPS。Phase 19)。表示と入力だけ。グループの作成は GROUP、図形の追加・除外は GROUPEDIT で行う。
 * 名前の変更・解除は、Undo の1段階。
 */
export function GroupPanel({ groups, pickStyle, onSelect, onRename, onUngroup, onTogglePickStyle, onClose }: GroupPanelProps) {
  const [result, setResult] = useState<EditOutcome | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; text: string } | null>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      if (renaming !== null) setRenaming(null);
      else onClose();
    }
  }

  return (
    <div className="layer-manager" role="dialog" aria-label="グループ" data-testid="group-panel" onKeyDown={handleKeyDown}>
      <div className="layer-manager__scale">
        <span>グループ({groups.length})</span>
        <label>
          <input type="checkbox" data-testid="group-pickstyle" checked={pickStyle} onChange={onTogglePickStyle} /> クリックでグループ全体を選ぶ(PICKSTYLE)
        </label>
      </div>
      {groups.length === 0 ? (
        <div className="layer-manager__note">グループはありません。図形を選んで GROUP(G)で作れます。</div>
      ) : (
        <div className="layer-manager__list">
          {groups.map((group) => (
            <div key={group.name} className="layer-manager__row" data-testid={`group-row-${group.name}`}>
              {renaming?.from === group.name ? (
                <input
                  type="text"
                  autoFocus
                  className="layer-manager__input layer-manager__name"
                  data-testid={`group-rename-input-${group.name}`}
                  value={renaming.text}
                  onChange={(event) => setRenaming({ from: group.name, text: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                      const outcome = onRename(group.name, renaming.text);
                      setResult(outcome);
                      if (outcome.ok) setRenaming(null);
                    }
                  }}
                />
              ) : (
                <span className="layer-manager__name" title={group.name}>
                  {group.name}
                </span>
              )}
              <span className="layer-manager__count">{group.ids.length} 個</span>
              <button type="button" data-testid={`group-select-${group.name}`} onClick={() => onSelect(group)}>
                選択
              </button>
              <button type="button" data-testid={`group-rename-${group.name}`} onClick={() => setRenaming(renaming?.from === group.name ? null : { from: group.name, text: group.name.startsWith("*") ? "" : group.name })}>
                名前
              </button>
              <button type="button" data-testid={`group-ungroup-${group.name}`} onClick={() => setResult(onUngroup(group))}>
                解除
              </button>
            </div>
          ))}
        </div>
      )}
      {result !== null && (
        <div className={result.ok ? "layer-manager__result" : "layer-manager__result layer-manager__result--error"} role={result.ok ? "status" : "alert"} data-testid="group-panel-result">
          {result.message}
        </div>
      )}
      <div className="layer-manager__note">「*」で始まる名前は、名前なしのグループ(複写したグループなど)です。「名前」で名前を付けられます。</div>
      <div className="layer-manager__actions">
        <button type="button" data-testid="group-panel-close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
