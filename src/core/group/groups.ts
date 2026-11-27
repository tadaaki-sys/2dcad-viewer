// グループ(Phase 19)の決まり: 名前の検証・名前の自動の付け方・図形からグループへの逆引き・削除に伴うメンバーの整理。
// 画面にもファイル形式にも依存しない純粋な処理。
import type { CadGroup } from "../../types/cad";
import type { Change } from "../history/changeSet";

export const MAX_GROUP_NAME_LENGTH = 255;

/** 名前を付けずに作ったグループの名前の頭(AutoCAD の名前なしグループと同じ) */
export const ANONYMOUS_PREFIX = "*A";

export type CheckedName = { ok: true; value: string } | { ok: false; error: string };

/**
 * グループ名の検証。前後の空白は取る。空・長すぎる・制御文字・"*" で始まる(名前なしグループ用)・同じ名前(大文字小文字は区別しない)は断る。
 * renaming は、名前を変えるグループ自身の名前(自分自身との重複は許す)。
 */
export function validateGroupName(name: string, groups: readonly CadGroup[], renaming?: string): CheckedName {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, error: "グループ名が空です" };
  if (trimmed.length > MAX_GROUP_NAME_LENGTH) return { ok: false, error: `グループ名が長すぎます(${MAX_GROUP_NAME_LENGTH}文字まで)` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return { ok: false, error: "グループ名に制御文字は使えません" };
  if (trimmed.startsWith("*")) return { ok: false, error: "「*」で始まる名前は、名前なしのグループのためのものです" };
  const upper = trimmed.toUpperCase();
  const clash = groups.find((group) => group.name.toUpperCase() === upper && group.name !== renaming);
  if (clash !== undefined) return { ok: false, error: `同じ名前のグループ「${clash.name}」があります(大文字小文字は区別しません)` };
  return { ok: true, value: trimmed };
}

/** 使われていない、名前なしグループの名前(*A1, *A2, ...)。taken は、この変更の中で、すでに使う名前 */
export function nextAnonymousName(groups: readonly CadGroup[], taken: ReadonlySet<string> = new Set()): string {
  const used = new Set(groups.map((group) => group.name.toUpperCase()));
  for (let n = 1; ; n++) {
    const name = `${ANONYMOUS_PREFIX}${n}`;
    if (!used.has(name.toUpperCase()) && !taken.has(name)) return name;
  }
}

const indexCache = new WeakMap<readonly CadGroup[], Map<string, number>>();

/** 図形の ID → それが入っているグループの位置(グループ表ごとに1回だけ作る) */
export function groupIndexOf(groups: readonly CadGroup[]): ReadonlyMap<string, number> {
  const cached = indexCache.get(groups);
  if (cached !== undefined) return cached;
  const index = new Map<string, number>();
  groups.forEach((group, i) => {
    for (const id of group.ids) index.set(id, i);
  });
  indexCache.set(groups, index);
  return index;
}

/** 図形が入っているグループ。無ければ undefined */
export function groupOf(groups: readonly CadGroup[], id: string): CadGroup | undefined {
  const index = groupIndexOf(groups).get(id);
  return index === undefined ? undefined : groups[index];
}

/** 図形の集合を、それぞれが入っているグループの全員まで広げる(グループ単位の選択)。グループに入っていない図形は、そのまま */
export function expandToGroups(groups: readonly CadGroup[], ids: Iterable<string>): Set<string> {
  const result = new Set<string>();
  if (groups.length === 0) {
    for (const id of ids) result.add(id);
    return result;
  }
  const index = groupIndexOf(groups);
  for (const id of ids) {
    result.add(id);
    const at = index.get(id);
    if (at !== undefined) for (const member of groups[at].ids) result.add(member);
  }
  return result;
}

/** 選択の変更の種類(画面の操作から): 置き換え(クリック・窓)・追加(Ctrl+窓)・切り替え(Ctrl+クリック) */
export type SelectionChangeMode = "replace" | "add" | "toggle";

/**
 * 選択の変更を、グループ単位に広げる(PICKSTYLE がオンのとき)。previous は、いままでの選択、next は、画面が作った新しい選択。
 *  - replace: next の図形の、グループの全員を選ぶ(選んであるグループの1つをクリックし直しても、グループのまま)
 *  - add: いままでの選択に、新しく加わった図形のグループの全員を足す
 *  - toggle: 外れた図形のグループの全員を外し、加わった図形のグループの全員を足す(Ctrl+クリックで、グループごと外せる)
 * 足すのは、accept が真の図形だけ(非表示・ロックの図形は足さない)。
 */
export function expandSelectionChange(groups: readonly CadGroup[], previous: ReadonlySet<string>, next: ReadonlySet<string>, accept: (id: string) => boolean, mode: SelectionChangeMode = "toggle"): Set<string> {
  const result = new Set(next);
  if (groups.length === 0) return result;
  const index = groupIndexOf(groups);
  const addGroupOf = (id: string): void => {
    const at = index.get(id);
    if (at !== undefined) for (const member of groups[at].ids) if (accept(member)) result.add(member);
  };
  if (mode === "replace") {
    for (const id of next) addGroupOf(id);
    return result;
  }
  if (mode === "toggle") {
    for (const id of previous) {
      if (next.has(id)) continue;
      const at = index.get(id);
      if (at !== undefined) for (const member of groups[at].ids) result.delete(member);
    }
  }
  for (const id of next) if (!previous.has(id)) addGroupOf(id);
  return result;
}
/**
 * 削除された図形を、グループから外す変更。空になったグループは、削除する。
 * 位置がずれないよう、後ろのグループから順に並べる(置き換えは位置を変えず、削除は、それより後ろの位置だけをずらす)。
 * emptied は、空になって削除したグループの名前。
 */
export function pruneGroups(groups: readonly CadGroup[], removedIds: ReadonlySet<string>): { changes: Change[]; emptied: string[]; trimmed: string[] } {
  const changes: Change[] = [];
  const emptied: string[] = [];
  const trimmed: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (!group.ids.some((id) => removedIds.has(id))) continue;
    const ids = group.ids.filter((id) => !removedIds.has(id));
    if (ids.length === 0) {
      changes.push({ kind: "groupRemove", group, index: i });
      emptied.push(group.name);
    } else {
      changes.push({ kind: "groupReplace", before: group, after: { name: group.name, ids }, index: i });
      trimmed.push(group.name);
    }
  }
  return { changes, emptied, trimmed };
}
