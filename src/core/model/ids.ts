/**
 * 図形ID。ドキュメント内で一意で、図形が移動・変更されても変わらない。
 *
 * - 取り込んだ図形: 読み込み時に振られる `e0`, `e1`, ... (ビューアの既存の選択・テストと同じ値)
 * - 新しく作る図形: `n0`, `n1`, ... (ドキュメントごとの払い出し番号から作る)
 */
export type EntityId = string;

const NEW_ENTITY_ID_PREFIX = "n";

/** 払い出し番号counterから、新しい図形のIDを作る */
export function newEntityId(counter: number): EntityId {
  return `${NEW_ENTITY_ID_PREFIX}${counter}`;
}

/** 新しく作る図形のID(`n<番号>`)から、払い出し番号を取り出す。そうでないIDは null */
export function parseNewEntityCounter(id: EntityId): number | null {
  const match = /^n(0|[1-9]\d*)$/.exec(id);
  if (match === null) return null;
  const counter = Number(match[1]);
  return Number.isSafeInteger(counter) ? counter : null;
}
