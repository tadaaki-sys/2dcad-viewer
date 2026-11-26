// 連動寸法(Phase 16): 図面の変更に、参照している寸法の追従を、足す。React にも画面にも依存しない。
//
// どの編集(MOVE・STRETCH・TRIM・FILLET・DELETE・Undo 以外のすべて)も、DocumentSession.apply を通る。
// そこで、変更(ChangeSet)の「後ろ」に、参照している寸法の置き換えを足して、1つの変更として適用する。
// だから、追従も含めて、Undo は1回で戻り、Redo も同じ(履歴には、足したあとの変更が記録される)。
// 追従の計算の規則は、core/dimension/dimensionFollow.ts。ここは、「どの寸法を、どの順で直すか」と、通知の文だけ。
import { followDimension } from "../../core/dimension/dimensionFollow";
import type { ChangedFigure } from "../../core/dimension/dimensionFollow";
import { applyChangeSet } from "../../core/history";
import type { ChangeSet, EntityChange } from "../../core/history";
import type { CadDocument, EntityId } from "../../core/model";
import type { CadEntity } from "../../types/cad";

export type AssociationPlan = {
  /** 追従を足した変更(追従するものが無ければ、渡した変更そのもの) */
  changeSet: ChangeSet;
  /** 利用者へ知らせること(参照が切れた・関連付けを解除した)。無ければ null */
  notice: string | null;
};

/** 参照している図形の ID → それを参照している寸法の ID */
type AssociationIndex = Map<EntityId, EntityId[]>;

const indexCache = new WeakMap<readonly CadEntity[], AssociationIndex>();

/** 図面の、参照の逆引き(図形の配列ごとに1回だけ作る。図面の図形の数に比例する単純な走査) */
function associationIndexOf(document: CadDocument): AssociationIndex {
  const cached = indexCache.get(document.entities);
  if (cached !== undefined) return cached;
  const index: AssociationIndex = new Map();
  for (const entity of document.entities) {
    if (entity.type !== "DIMENSION" || entity.refs === undefined) continue;
    for (const ref of entity.refs) {
      const list = index.get(ref.id);
      if (list === undefined) index.set(ref.id, [entity.id]);
      else if (list[list.length - 1] !== entity.id) list.push(entity.id);
    }
  }
  indexCache.set(document.entities, index);
  return index;
}

/** 折れ線の、頂点の数・閉じ方が変わったか(頂点の番号が、元の頂点と対応しなくなる編集) */
function polylineRestructured(before: CadEntity, after: CadEntity): boolean {
  const isPolyline = (e: CadEntity): e is Extract<CadEntity, { type: "LWPOLYLINE" | "POLYLINE" }> => e.type === "LWPOLYLINE" || e.type === "POLYLINE";
  if (!isPolyline(before)) return false;
  return !isPolyline(after) || before.vertices.length !== after.vertices.length || before.closed !== after.closed;
}

/** 変更の中で、置き換えられた・削除された図形(同じ図形が複数回出るときは、最初の before と最後の after) */
function changedFigures(changeSet: ChangeSet): Map<EntityId, ChangedFigure> {
  const changed = new Map<EntityId, ChangedFigure>();
  for (const change of changeSet.changes) {
    if (change.kind === "replace") {
      const previous = changed.get(change.after.id);
      changed.set(change.after.id, {
        before: previous === undefined ? change.before : previous.before,
        after: change.after,
        // どれか1つの置き換えで、折れ線の頂点の数・閉じ方が変わったら、頂点の番号は、当てにならない(最後の状態が、始めと似ていても)
        restructured: (previous?.restructured ?? false) || polylineRestructured(change.before, change.after),
      });
    } else if (change.kind === "remove") {
      const previous = changed.get(change.entity.id);
      changed.set(change.entity.id, { before: previous === undefined ? change.entity : previous.before, after: null });
    } else if (change.kind === "add") {
      // 削除した図形を、同じ変更の中で、あらためて追加する場合だけ、after を更新する(新しい図形の追加は、追従に関係しない)
      const previous = changed.get(change.entity.id);
      if (previous !== undefined) changed.set(change.entity.id, { before: previous.before, after: change.entity });
    }
  }
  return changed;
}

/**
 * 変更に、参照している寸法の追従を足す。追従するものが無いときは、渡した変更を、そのまま返す(高速な経路を、保つため)。
 * 変更が適用できないときも、そのまま返す(適用の側が、理由を返す)。
 */
export function planAssociation(document: CadDocument, changeSet: ChangeSet): AssociationPlan {
  const unchanged: AssociationPlan = { changeSet, notice: null };
  const changed = changedFigures(changeSet);
  if (changed.size === 0) return unchanged;

  // 追従が要る寸法: 参照している図形が変わった寸法と、寸法そのものが変わった(参照を持つ)寸法
  const affected = new Set<EntityId>();
  for (const [id, figure] of changed) {
    if (figure.after !== null && figure.after.type === "DIMENSION" && figure.after.refs !== undefined && figure.after.refs.length > 0) affected.add(id);
  }
  const index = associationIndexOf(document);
  if (index.size > 0) {
    for (const id of changed.keys()) {
      const dependents = index.get(id);
      if (dependents !== undefined) for (const dimensionId of dependents) affected.add(dimensionId);
    }
  }
  if (affected.size === 0) return unchanged;

  const next = applyChangeSet(document, changeSet);
  if (!next.ok) return unchanged;
  const after = next.document;
  const context = {
    lookup: (id: EntityId): CadEntity | undefined => {
      const at = after.indexById.get(id);
      return at === undefined ? undefined : after.entities[at];
    },
    changed: (id: EntityId): ChangedFigure | undefined => changed.get(id),
  };

  const followUps: Array<{ index: number; change: EntityChange; broken: boolean; released: boolean }> = [];
  for (const id of affected) {
    const at = after.indexById.get(id);
    if (at === undefined) continue;
    const current = after.entities[at];
    if (current.type !== "DIMENSION") continue;
    const result = followDimension(current, context);
    if (result === null) continue;
    followUps.push({
      index: at,
      change: { kind: "replace", before: current, after: result.dimension, index: at },
      broken: result.broken > 0,
      released: result.released > 0,
    });
  }
  if (followUps.length === 0) return unchanged;
  // 位置の小さい順(結果が、集合の順序に依らないように)
  followUps.sort((a, b) => a.index - b.index);

  const brokenCount = followUps.filter((f) => f.broken).length;
  const releasedCount = followUps.filter((f) => f.released).length;
  const notes: string[] = [];
  if (brokenCount > 0) notes.push(`寸法 ${brokenCount} 個の参照が切れました(Broken Reference。赤で表示します。DIMREASSOC で付け直せます)`);
  if (releasedCount > 0) notes.push(`寸法 ${releasedCount} 個の関連付けを、動かした点について解除しました(DIMREASSOC で付け直せます)`);
  return {
    changeSet: { label: changeSet.label, changes: [...changeSet.changes, ...followUps.map((f) => f.change)] },
    notice: notes.length > 0 ? notes.join("。") : null,
  };
}
