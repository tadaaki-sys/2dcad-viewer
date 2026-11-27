// グループ(Phase 19)の作成・解除・編集・名前の変更と、図形の削除に伴うメンバーの整理を、図面に適用する。
// React にも画面にも依存しない。どれも、DocumentSession.apply を通る1つの変更(Undo は1段階)。
import { ANONYMOUS_PREFIX, expandToGroups, groupIndexOf, nextAnonymousName, pruneGroups, validateGroupName } from "../../core/group/groups";
import type { Change, ChangeSet } from "../../core/history";
import { hasEntity } from "../../core/model";
import type { CadDocument, EntityId } from "../../core/model";
import type { CadGroup } from "../../types/cad";
import { resolveEditTargets } from "./editability";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";
import type { EditOutcome } from "./editing";

const fail = (message: string): EditOutcome => ({ ok: false, message });

const isGroupChange = (change: Change): boolean => change.kind === "groupAdd" || change.kind === "groupRemove" || change.kind === "groupReplace";

/**
 * 図形の削除に伴うグループの整理を、変更の後ろに足す(DocumentSession.apply が、連動寸法の追従のあとに呼ぶ)。
 * 削除された(同じ変更の中で、追加し直されていない)図形を、グループから外し、空になったグループは削除する。
 * グループ表を自分で変える変更(グループの作成・解除など)は、その変更が責任を持つので、足さない。整理が要らなければ、渡した変更そのもの。
 */
export function planGroupMaintenance(document: CadDocument, changeSet: ChangeSet): { changeSet: ChangeSet; notice: string | null } {
  const unchanged = { changeSet, notice: null };
  if (document.groups.length === 0 || changeSet.changes.some(isGroupChange)) return unchanged;
  const removed = new Set<string>();
  for (const change of changeSet.changes) {
    if (change.kind === "remove") removed.add(change.entity.id);
    else if (change.kind === "add") removed.delete(change.entity.id);
  }
  if (removed.size === 0) return unchanged;
  const index = groupIndexOf(document.groups);
  let any = false;
  for (const id of removed) {
    if (index.has(id)) {
      any = true;
      break;
    }
  }
  if (!any) return unchanged;
  const pruned = pruneGroups(document.groups, removed);
  const notice = pruned.emptied.length > 0 ? `図形が無くなったグループ ${pruned.emptied.map((n) => `「${n}」`).join("")} を削除しました` : null;
  return { changeSet: { label: changeSet.label, changes: [...changeSet.changes, ...pruned.changes] }, notice };
}

/** 図形が入っているグループの名前(無ければ、空) */
function groupNamesOf(document: CadDocument, ids: readonly EntityId[]): string[] {
  const index = groupIndexOf(document.groups);
  const names = new Set<string>();
  for (const id of ids) {
    const at = index.get(id);
    if (at !== undefined) names.add(document.groups[at].name);
  }
  return [...names];
}

/**
 * 選んだ図形(編集できるもの)で、グループを作る。name が null(または空)なら、名前なしのグループ(*A1 など)。
 * 1つの図形は、1つのグループにだけ入るので、すでにグループに入っている図形があれば、断る。
 */
export function createGroup(session: DocumentSession, editability: Editability, ids: readonly EntityId[], name: string | null): EditOutcome {
  const document = session.document;
  const targets = resolveEditTargets(editability, ids);
  const members = targets.editable.filter((id) => hasEntity(document, id));
  if (members.length === 0) return fail(`グループを作れませんでした: 編集できる図形が選ばれていません${targets.reason === null ? "" : `(${targets.reason})`}`);
  const already = groupNamesOf(document, members);
  if (already.length > 0) return fail(`グループを作れませんでした: すでにグループ ${already.map((n) => `「${n}」`).join("")} に入っている図形があります(UNGROUP で解除してから)`);
  let groupName: string;
  if (name === null || name.trim() === "") groupName = nextAnonymousName(document.groups);
  else {
    const checked = validateGroupName(name, document.groups);
    if (!checked.ok) return fail(`グループを作れませんでした: ${checked.error}`);
    groupName = checked.value;
  }
  const group: CadGroup = { name: groupName, ids: members };
  const outcome = session.apply({ label: `グループ「${groupName}」を作成`, changes: [{ kind: "groupAdd", group, index: document.groups.length }] });
  if (!outcome.ok) return fail(`グループを作れませんでした: ${outcome.error}`);
  const skipped = targets.skipped > 0 ? `(編集できない図形 ${targets.skipped} 個は除きました)` : "";
  return { ok: true, message: `グループ「${groupName}」を作りました(${members.length} 個の図形)${skipped}` };
}

/**
 * 選んだ図形が入っているグループを、解除する(図形は、そのまま)。複数のグループでも、1段階。
 * editability を渡したとき(コマンドで、選んだ図形から解除するとき)は、編集できない図形(ロック・読み取り専用)では、グループを指せない。
 * グループの一覧のパネルからの解除(グループを名前で指す)は、渡さない(名前の変更と同じく、グループ表の操作)。
 */
export function ungroup(session: DocumentSession, ids: readonly EntityId[], editability: Editability | null = null): EditOutcome {
  const document = session.document;
  const index = groupIndexOf(document.groups);
  const targets = editability === null ? null : resolveEditTargets(editability, ids);
  const usable = targets === null ? ids : targets.editable;
  const positions = [...new Set(usable.map((id) => index.get(id)).filter((at): at is number => at !== undefined))].sort((a, b) => b - a);
  if (positions.length === 0) return fail(`選んだ図形は、どのグループにも入っていません${targets === null || targets.reason === null ? "" : `(${targets.reason})`}`);
  const names = positions.map((at) => document.groups[at].name).reverse();
  const outcome = session.apply({
    label: `グループを解除(${names.length}個)`,
    changes: positions.map((at) => ({ kind: "groupRemove" as const, group: document.groups[at], index: at })),
  });
  if (!outcome.ok) return fail(`グループを解除できませんでした: ${outcome.error}`);
  return { ok: true, message: `グループ ${names.map((n) => `「${n}」`).join("")} を解除しました` };
}

/**
 * グループに図形を足す(add)・グループから図形を外す(remove)。外して空になるなら、グループを削除する。
 * 足す図形は、編集できるもので、ほかのグループに入っていないもの。
 */
export function editGroup(session: DocumentSession, editability: Editability, name: string, ids: readonly EntityId[], mode: "add" | "remove"): EditOutcome {
  const document = session.document;
  const at = document.groups.findIndex((group) => group.name.toUpperCase() === name.trim().toUpperCase());
  if (at < 0) return fail(`グループ「${name.trim()}」がありません`);
  const group = document.groups[at];
  if (mode === "add") {
    const targets = resolveEditTargets(editability, ids);
    const candidates = targets.editable.filter((id) => hasEntity(document, id) && !group.ids.includes(id));
    if (candidates.length === 0) return fail(`グループ「${group.name}」に足せる図形がありません${targets.reason === null ? "(すでに入っています)" : `(${targets.reason})`}`);
    const others = groupNamesOf(document, candidates);
    if (others.length > 0) return fail(`ほかのグループ ${others.map((n) => `「${n}」`).join("")} に入っている図形は、足せません`);
    const after: CadGroup = { name: group.name, ids: [...group.ids, ...candidates] };
    const outcome = session.apply({ label: `グループ「${group.name}」に図形を追加`, changes: [{ kind: "groupReplace", before: group, after, index: at }] });
    if (!outcome.ok) return fail(`グループを編集できませんでした: ${outcome.error}`);
    return { ok: true, message: `グループ「${group.name}」に ${candidates.length} 個の図形を足しました(合計 ${after.ids.length} 個)` };
  }
  // 外す図形も、編集できるものだけ(ロックされた図形の、グループの所属は変えない)
  const targets = resolveEditTargets(editability, ids);
  const removing = new Set(targets.editable);
  const remaining = group.ids.filter((id) => !removing.has(id));
  const count = group.ids.length - remaining.length;
  if (count === 0) return fail(`選んだ図形は、グループ「${group.name}」に入っていません${targets.reason === null ? "" : `(${targets.reason})`}`);
  const change: Change = remaining.length === 0 ? { kind: "groupRemove", group, index: at } : { kind: "groupReplace", before: group, after: { name: group.name, ids: remaining }, index: at };
  const outcome = session.apply({ label: `グループ「${group.name}」から図形を除外`, changes: [change] });
  if (!outcome.ok) return fail(`グループを編集できませんでした: ${outcome.error}`);
  return { ok: true, message: remaining.length === 0 ? `グループ「${group.name}」は、図形が無くなったので削除しました` : `グループ「${group.name}」から ${count} 個の図形を外しました(残り ${remaining.length} 個)` };
}

/** グループの名前を変える(名前なしのグループに、名前を付けることもできる) */
export function renameGroup(session: DocumentSession, from: string, to: string): EditOutcome {
  const document = session.document;
  const at = document.groups.findIndex((group) => group.name === from);
  if (at < 0) return fail(`グループ「${from}」がありません`);
  const checked = validateGroupName(to, document.groups, from);
  if (!checked.ok) return fail(`名前を変えられませんでした: ${checked.error}`);
  if (checked.value === from) return fail("名前が同じです");
  const group = document.groups[at];
  const outcome = session.apply({ label: `グループ「${from}」を「${checked.value}」に名前変更`, changes: [{ kind: "groupReplace", before: group, after: { name: checked.value, ids: group.ids }, index: at }] });
  if (!outcome.ok) return fail(`名前を変えられませんでした: ${outcome.error}`);
  return { ok: true, message: `グループ「${from}」を「${checked.value}」に変えました` };
}

/**
 * 図形を複写したときに、グループの全員を複写したなら、複写先も、同じ形の名前なしグループにする変更(複写1回ごとに1つ)。
 * copyIdOf[m] は、m 回目の複写の「元の ID → 複写の ID」。
 */
export function groupsForCopies(document: CadDocument, sourceIds: ReadonlySet<string>, copyIdOf: ReadonlyArray<ReadonlyMap<string, string>>): Change[] {
  const changes: Change[] = [];
  // 使われている名前を1回だけ集め、番号を進めながら空きを探す(複写するグループが多くても、名前の集め直しを繰り返さない)
  const used = new Set(document.groups.map((group) => group.name.toUpperCase()));
  let counter = 1;
  const nextName = (): string => {
    while (used.has(`${ANONYMOUS_PREFIX}${counter}`.toUpperCase())) counter++;
    const name = `${ANONYMOUS_PREFIX}${counter}`;
    used.add(name.toUpperCase());
    return name;
  };
  let index = document.groups.length;
  for (const group of document.groups) {
    if (!group.ids.every((id) => sourceIds.has(id))) continue;
    for (const mapping of copyIdOf) {
      const ids = group.ids.map((id) => mapping.get(id)).filter((id): id is string => id !== undefined);
      if (ids.length !== group.ids.length) continue;
      changes.push({ kind: "groupAdd", group: { name: nextName(), ids }, index: index++ });
    }
  }
  return changes;
}

export { expandToGroups };
