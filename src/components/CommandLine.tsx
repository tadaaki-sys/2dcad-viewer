import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { CommandHistory } from "../core/commands";
import type { ActiveCommand } from "../core/commands";
import "./CommandLine.css";

type CommandLineProps = {
  /** 表示するメッセージ(古い順) */
  log: readonly string[];
  /** 実行中のコマンド。無ければ null */
  active: ActiveCommand | null;
  /** 入力欄。Enterキーで入力欄へ移る(App側)ために、外から触れるようにする */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Enterで、入力した文字を実行する */
  onSubmit: (text: string) => void;
  /** Escで、実行中のコマンドを取り消す */
  onCancel: () => void;
};

export function CommandLine({ log, active, inputRef, onSubmit, onCancel }: CommandLineProps) {
  const [text, setText] = useState("");
  const historyRef = useRef(new CommandHistory());
  const logRef = useRef<HTMLDivElement>(null);

  // 新しいメッセージが来たら、いちばん下までスクロールする
  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 日本語入力の変換を確定するEnter・Esc・矢印は、ここでは扱わない
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const submitted = text;
      historyRef.current.push(submitted);
      setText("");
      onSubmit(submitted);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setText("");
      historyRef.current.resetCursor();
      onCancel();
      event.currentTarget.blur();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setText(historyRef.current.previous(text));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setText(historyRef.current.next(text));
    }
  }

  return (
    <div className="command-line" data-testid="command-line">
      <div ref={logRef} className="command-line__log" role="log" aria-live="polite" data-testid="command-line-log">
        {log.map((line, index) => (
          <div key={index} className="command-line__log-line">
            {line}
          </div>
        ))}
      </div>
      <div className="command-line__input-row">
        <span className="command-line__label" data-testid="command-line-label">
          {active ? `${active.name}:` : "コマンド:"}
        </span>
        <input
          ref={inputRef}
          type="text"
          className="command-line__input"
          data-testid="command-line-input"
          value={text}
          placeholder={active ? active.prompt : "コマンドを入力(例: FIT, MEASURE, ID)。Enterキーで、ここへ移動"}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setText(event.target.value);
            historyRef.current.resetCursor();
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
