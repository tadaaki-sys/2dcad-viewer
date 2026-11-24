import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import "./TextInputPanel.css";

type TextInputPanelProps = {
  /** コマンドの案内(例: 「文字を入力してください(Enter で確定、Esc で取り消し)」) */
  title: string;
  /** 複数行か。複数行は Ctrl+Enter で確定、1行は Enter で確定 */
  multiline: boolean;
  /** 最初に入れておく文字(編集のとき) */
  initial: string;
  /** 確定(入力した文字を渡す。空・長すぎるときは、コマンドが理由を出して、同じ段階のまま待つ) */
  onSubmit: (text: string) => void;
  /** Esc・キャンセルボタン: コマンドを取り消す */
  onCancel: () => void;
};

/**
 * 文字(TEXT・MTEXT)の内容を入力する小さなパネル(画面の下寄り)。日本語の入力(IME)の変換を確定する Enter・Esc は、ここでは扱わない。
 * 表示するたびに作り直す(key を変える)ので、初期の文字は、そのたびに入れ直す。
 */
export function TextInputPanel({ title, multiline, initial, onSubmit, onCancel }: TextInputPanelProps) {
  const [text, setText] = useState(initial);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    if (field === null) return;
    field.focus();
    field.select();
  }, []);

  // Esc は、パネルのどこにフォーカスがあっても(ボタンでも)、コマンドを取り消す。IME の変換中の Esc は、変換の取り消しなので、扱わない
  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key !== "Enter") return;
    // 複数行は Ctrl+Enter(Mac は Cmd+Enter)で確定、Enter は改行。1行は Enter で確定
    if (multiline ? event.ctrlKey || event.metaKey : !event.shiftKey) {
      event.preventDefault();
      onSubmit(text);
    }
  }

  return (
    <div className="text-input-panel" role="dialog" aria-label="文字の入力" data-testid="text-input-panel" onKeyDown={handlePanelKeyDown}>
      <div className="text-input-panel__title">{title}</div>
      {multiline ? (
        <textarea
          ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
          className="text-input-panel__field text-input-panel__field--multiline"
          data-testid="text-input-field"
          value={text}
          rows={5}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <input
          ref={fieldRef as React.RefObject<HTMLInputElement>}
          type="text"
          className="text-input-panel__field"
          data-testid="text-input-field"
          value={text}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      )}
      <div className="text-input-panel__actions">
        <button type="button" data-testid="text-input-ok" onClick={() => onSubmit(text)}>
          OK
        </button>
        <button type="button" data-testid="text-input-cancel" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  );
}