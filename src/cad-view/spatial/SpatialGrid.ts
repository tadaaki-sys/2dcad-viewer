import type { CadBounds } from "../../types/cad";
import { BOUNDS_STRIDE } from "./entityBounds";

const TARGET_ENTITIES_PER_CELL = 3;
const MAX_CELLS_PER_AXIS = 512;
// これより多くのセルにまたがる大きな図形(図枠の外周線など)は、セルへ登録せず常に候補として検査する
const MAX_CELLS_PER_ENTITY = 64;

/**
 * 図形のバウンディングボックスを一様格子へ登録した空間索引。
 * 点や矩形の周辺にある図形だけを取り出すことで、選択・スナップ・描画が全図形の総当たりにならないようにする。
 */
export class SpatialGrid {
  private readonly entityBounds: Float64Array;
  private readonly originX: number;
  private readonly originY: number;
  private readonly cellSize: number;
  private readonly columns: number;
  private readonly rows: number;
  /** CSR形式。cellStart[c]..cellStart[c+1] が セルcに登録された図形番号の範囲 */
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  private readonly largeEntities: number[] = [];
  private readonly stamps: Uint32Array;
  private stamp = 0;

  constructor(entityBounds: Float64Array, worldBounds: CadBounds | null) {
    this.entityBounds = entityBounds;
    const count = entityBounds.length / BOUNDS_STRIDE;
    this.stamps = new Uint32Array(count);

    const width = worldBounds ? Math.max(worldBounds.max.x - worldBounds.min.x, 1) : 1;
    const height = worldBounds ? Math.max(worldBounds.max.y - worldBounds.min.y, 1) : 1;
    this.originX = worldBounds ? worldBounds.min.x : 0;
    this.originY = worldBounds ? worldBounds.min.y : 0;

    const targetCells = Math.max(1, count / TARGET_ENTITIES_PER_CELL);
    this.cellSize = Math.max(Math.sqrt((width * height) / targetCells), Math.max(width, height) / MAX_CELLS_PER_AXIS);
    this.columns = Math.max(1, Math.min(MAX_CELLS_PER_AXIS, Math.ceil(width / this.cellSize)));
    this.rows = Math.max(1, Math.min(MAX_CELLS_PER_AXIS, Math.ceil(height / this.cellSize)));

    const cellCount = this.columns * this.rows;
    const counts = new Int32Array(cellCount + 1);
    const ranges = new Int32Array(count * 4);

    for (let i = 0; i < count; i++) {
      const o = i * BOUNDS_STRIDE;
      const c0 = this.columnOf(entityBounds[o]);
      const r0 = this.rowOf(entityBounds[o + 1]);
      const c1 = this.columnOf(entityBounds[o + 2]);
      const r1 = this.rowOf(entityBounds[o + 3]);
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_CELLS_PER_ENTITY) {
        ranges[i * 4] = -1;
        this.largeEntities.push(i);
        continue;
      }
      ranges[i * 4] = c0;
      ranges[i * 4 + 1] = r0;
      ranges[i * 4 + 2] = c1;
      ranges[i * 4 + 3] = r1;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) counts[r * this.columns + c + 1]++;
      }
    }

    for (let c = 0; c < cellCount; c++) counts[c + 1] += counts[c];
    this.cellStart = counts;
    this.cellItems = new Int32Array(counts[cellCount]);
    const fill = counts.slice(0, cellCount);
    for (let i = 0; i < count; i++) {
      if (ranges[i * 4] < 0) continue;
      const c0 = ranges[i * 4];
      const r0 = ranges[i * 4 + 1];
      const c1 = ranges[i * 4 + 2];
      const r1 = ranges[i * 4 + 3];
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) this.cellItems[fill[r * this.columns + c]++] = i;
      }
    }
  }

  private columnOf(x: number): number {
    if (!(x > -Infinity)) return 0;
    if (x === Infinity) return this.columns - 1;
    return Math.max(0, Math.min(this.columns - 1, Math.floor((x - this.originX) / this.cellSize)));
  }

  private rowOf(y: number): number {
    if (!(y > -Infinity)) return 0;
    if (y === Infinity) return this.rows - 1;
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.originY) / this.cellSize)));
  }

  /**
   * 範囲と交差するバウンディングボックスを持つ図形番号を、重複なしで返す。
   * 既定では図形の登録順(昇順)に並べる。順序が不要な呼び出し(描画など)はsorted=falseで並べ替えを省ける。
   */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, sorted = true): number[] {
    const result: number[] = [];
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    const bounds = this.entityBounds;

    const consider = (i: number) => {
      if (this.stamps[i] === stamp) return;
      this.stamps[i] = stamp;
      const o = i * BOUNDS_STRIDE;
      if (bounds[o] <= maxX && bounds[o + 2] >= minX && bounds[o + 1] <= maxY && bounds[o + 3] >= minY) result.push(i);
    };

    const c0 = this.columnOf(minX);
    const c1 = this.columnOf(maxX);
    const r0 = this.rowOf(minY);
    const r1 = this.rowOf(maxY);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.columns + c;
        for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) consider(this.cellItems[k]);
      }
    }
    for (const i of this.largeEntities) consider(i);

    return sorted ? result.sort((a, b) => a - b) : result;
  }
}
