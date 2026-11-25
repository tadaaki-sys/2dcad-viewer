// 編集コマンドが使う情報(AppEditing)を作る。画面の側が、いまの図面・編集可否の判断・選択を、関数で渡す。
// 関数で渡すので、コマンドは、始まる時点の(最新の)状態を読める。React にも画面にも依存しない。
import { createBreakPreview, createOffsetPreview, createSelectionPreview, createStretchPreview } from "../../core/commands/entityPreview";
import { boundsTouchWindow } from "../../core/geometry/stretch";
import { BOUNDS_STRIDE, computeAllEntityBounds } from "../../core/spatial/entityBounds";
import { getEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import type { CadEntity } from "../../types/cad";
import type { AppEditing } from "../commands/types";
import { resolveEditTargets } from "./editability";
import { pickEntityAt, pickTargetOf } from "./picking";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";

export type AppEditingSources = {
  /** 図面の準備ができていて(読み込み中でなく)、編集できるか */
  ready: boolean;
  getSession: () => DocumentSession | null;
  getEditability: () => Editability;
  getSelection: () => Iterable<EntityId>;
  /** 表示中のレイヤーの名前(非表示のレイヤーの図形は、クリックで指せない) */
  getVisibleLayerNames: () => ReadonlySet<string>;
  /** 最後に図面をクリックしたときの、図形を指す許容距離(図面上の長さ) */
  getPickTolerance: () => number;
}

export function createAppEditing(sources: AppEditingSources): AppEditing {
  return {
    ready: sources.ready,
    getSelection: () => [...sources.getSelection()],
    resolveTargets: (ids) => resolveEditTargets(sources.getEditability(), ids),
    createPreview: (ids) => {
      const session = sources.getSession();
      const entities: CadEntity[] = [];
      if (session !== null) {
        for (const id of ids) {
          const entity = getEntity(session.document, id);
          if (entity !== undefined) entities.push(entity);
        }
      }
      return createSelectionPreview(entities);
    },
    findInWindow: (window) => {
      const session = sources.getSession();
      if (session === null) return { editable: [], skipped: 0, reason: null };
      // 窓に範囲が重なる図形を、全部の図形から探す(1回の操作につき1回だけ。10万図形でも数十ミリ秒)
      const entities = session.document.entities;
      const bounds = computeAllEntityBounds(entities);
      const touching: EntityId[] = [];
      for (let i = 0; i < entities.length; i++) {
        if (boundsTouchWindow(bounds, i * BOUNDS_STRIDE, window)) touching.push(entities[i].id);
      }
      return resolveEditTargets(sources.getEditability(), touching);
    },
    createStretchPreview: (ids, window) => {
      const session = sources.getSession();
      const entities: CadEntity[] = [];
      if (session !== null) {
        for (const id of ids) {
          const entity = getEntity(session.document, id);
          if (entity !== undefined) entities.push(entity);
        }
      }
      return createStretchPreview(entities, window);
    },
    pickEntity: (point, name, kind = "curve") => {
      const session = sources.getSession();
      if (session === null) return { ok: false, message: "図面の準備中です" };
      const target = pickTargetOf(kind);
      const picked = pickEntityAt(session, sources.getEditability(), point, sources.getPickTolerance(), sources.getVisibleLayerNames(), target.types, name, undefined, target.label);
      return picked.ok ? { ok: true, id: picked.entity.id } : picked;
    },
    createOffsetPreview: (id) => {
      const entity = sources.getSession() === null ? undefined : getEntity(sources.getSession()!.document, id);
      return entity === undefined ? () => [] : createOffsetPreview(entity);
    },
    createBreakPreview: (id, first) => {
      const entity = sources.getSession() === null ? undefined : getEntity(sources.getSession()!.document, id);
      return entity === undefined ? () => [] : createBreakPreview(entity, first);
    },
    entityOf: (id) => {
      const session = sources.getSession();
      return (session === null ? undefined : getEntity(session.document, id)) ?? null;
    },
    textOf: (id) => {
      const session = sources.getSession();
      const entity = session === null ? undefined : getEntity(session.document, id);
      return entity !== undefined && entity.type === "TEXT" ? { text: entity.text, isMText: entity.isMText === true } : null;
    },
  };
}
