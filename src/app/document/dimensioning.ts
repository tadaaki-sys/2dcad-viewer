// 寸法の関連付けし直し(DIMREASSOC。Phase 16)を、図面に適用する。React にも画面にも依存しない。
// 置き換え(IDは変わらない)の1回 = Undo の1段階。参照が、実在する図形の、実在する位置であることを確かめてから適用する。
import { angularFromLines } from "../../core/dimension/dimensionConstruct";
import { layoutDimension } from "../../core/dimension/dimensionGeometry";
import { isSameAnchorPoint, resolveAnchor } from "../../core/dimension/dimensionRefs";
import { replaceEntitiesChangeSet } from "../../core/history";
import { getEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import type { CadDimension, CadEntity, DimensionRef, Point2D } from "../../types/cad";
import { resolveEditTargets } from "./editability";
import type { Editability } from "./editability";
import type { EditOutcome } from "./editing";
import type { DocumentSession } from "./documentSession";

const NAME = "寸法の関連付け";

/** 参照が、実在する図形の、実在する位置か(点の参照は、測る点と一致していること) */
function refProblem(ref: DimensionRef, dimension: CadDimension, entity: CadEntity | undefined): string | null {
  if (entity === undefined) return `参照している図形が見つかりません(${ref.id})`;
  if (ref.slot === "p1" || ref.slot === "p2" || ref.slot === "p3") {
    const at = resolveAnchor(entity, ref.anchor);
    const point: Point2D | undefined = dimension[ref.slot];
    if (at === null) return `参照している図形に、その位置がありません(${ref.id})`;
    if (point === undefined || !isSameAnchorPoint(at, point)) return `測る点が、参照している図形の位置と一致しません(${ref.id})`;
    return null;
  }
  if (ref.slot === "figure") {
    if (entity.type !== "CIRCLE" && entity.type !== "ARC") return `円・円弧ではありません(${ref.id})`;
    // 寸法の中心・半径が、いまの円と合っていること(古い値で作った寸法を、いまの円に付けない)
    const radius = Math.hypot(dimension.p2.x - dimension.p1.x, dimension.p2.y - dimension.p1.y);
    if (!isSameAnchorPoint(entity.center, dimension.p1) || !(Math.abs(radius - entity.radius) <= 1e-6 * Math.max(1, entity.radius))) return `寸法の中心・半径が、参照している円・円弧と一致しません(${ref.id})`;
    return null;
  }
  return entity.type === "LINE" ? null : `線ではありません(${ref.id})`;
}

/** 角度寸法の、2本の線の参照: 頂点・腕の上の点が、いまの2本の線と、弧が通る点から求めた位置と合っていること */
function lineRefsProblem(dimension: CadDimension, entities: ReadonlyArray<CadEntity | undefined>): string | null {
  const [first, second] = entities;
  if (first === undefined || second === undefined || first.type !== "LINE" || second.type !== "LINE") return null;
  const solved = angularFromLines({ start: first.start, end: first.end }, { start: second.start, end: second.end }, dimension.position);
  if (!solved.ok) return solved.reason;
  const p3 = dimension.p3;
  if (p3 === undefined || !isSameAnchorPoint(solved.vertex, dimension.p1) || !isSameAnchorPoint(solved.arm1, dimension.p2) || !isSameAnchorPoint(solved.arm2, p3)) {
    return "寸法の頂点・腕が、参照している2本の線と一致しません";
  }
  return null;
}

export function reassociateDimension(session: DocumentSession, editability: Editability, id: EntityId, dimension: CadDimension): EditOutcome {
  const current = getEntity(session.document, id);
  if (current === undefined || current.type !== "DIMENSION") return { ok: false, message: `${NAME}できません: 寸法が見つかりません(削除された可能性があります)` };
  if (dimension.id !== id) return { ok: false, message: `${NAME}できません: 寸法のIDが合いません` };
  const targets = resolveEditTargets(editability, [id]);
  if (targets.editable.length === 0) return { ok: false, message: `${NAME}できません: ${targets.reason ?? "この寸法は編集できません"}` };
  if (layoutDimension(dimension) === null) return { ok: false, message: `${NAME}できません: 寸法の形を計算できません` };
  for (const ref of dimension.refs ?? []) {
    const problem = refProblem(ref, dimension, getEntity(session.document, ref.id));
    if (problem !== null) return { ok: false, message: `${NAME}できません: ${problem}` };
  }
  const lineRefs = (dimension.refs ?? []).filter((ref) => ref.slot === "line1" || ref.slot === "line2");
  if (lineRefs.length > 0) {
    const first = lineRefs.find((ref) => ref.slot === "line1");
    const second = lineRefs.find((ref) => ref.slot === "line2");
    const problem = lineRefsProblem(dimension, [first === undefined ? undefined : getEntity(session.document, first.id), second === undefined ? undefined : getEntity(session.document, second.id)]);
    if (problem !== null) return { ok: false, message: `${NAME}できません: ${problem}` };
  }
  let changeSet;
  try {
    changeSet = replaceEntitiesChangeSet(session.document, [dimension], "寸法を関連付け");
  } catch (error) {
    return { ok: false, message: `${NAME}できません: ${error instanceof Error ? error.message : String(error)}` };
  }
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return { ok: false, message: `${NAME}できません: ${outcome.error}` };
  const count = dimension.refs?.length ?? 0;
  return { ok: true, message: count > 0 ? `寸法を関連付けました(${count}か所)` : "寸法を更新しました(関連付けた点はありません)" };
}