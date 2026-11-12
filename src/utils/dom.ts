/** 文字を入力する欄(入力欄・テキストエリア・編集可能な要素)か。ここへのキー入力は、ショートカットとして扱わない */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}
