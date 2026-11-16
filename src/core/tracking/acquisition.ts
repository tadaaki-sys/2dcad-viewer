// OTRACK の取得点の管理: 吸着点の上にカーソルを一定時間とどめると取得し(取得済みの点なら解除し)、最大数を超えたら古いものから捨てる。
// 時間の計測は、外から渡された仕組み(Scheduler)で行う(画面では setTimeout、テストでは仮想の時計)。画面にも図面データにも依存しない。
import type { Point2D } from "../../types/cad";

/** 吸着点の上にカーソルをこの時間(ミリ秒)とどめると、その点を取得する */
export const OBJECT_TRACKING_DWELL_MS = 300;
/** 同時に取得しておける点の数(多いと、取得した古い点が消える) */
export const MAX_ACQUIRED_POINTS = 3;

/** 時間を計る仕組み(window.setTimeout と同じ形) */
export type Scheduler = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

/** 同じ点とみなす距離(mm)。同じ交点が、別の線分の組から、わずかに違う座標で返されても、同じ点として扱う。座標が大きいほど、誤差も大きい */
function isSamePoint(a: Point2D, b: Point2D): boolean {
  const epsilon = 1e-6 + 1e-12 * (Math.abs(a.x) + Math.abs(a.y));
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

export class ObjectTrackingAcquirer {
  private acquired: readonly Point2D[] = [];
  private candidate: Point2D | null = null;
  private timer: unknown = null;
  private readonly scheduler: Scheduler;
  private readonly onChange: () => void;
  private readonly dwellMs: number;
  private readonly maxPoints: number;

  /** onChange は、取得した点が変わったとき(取得・解除・全部捨てた)に呼ぶ */
  constructor(scheduler: Scheduler, onChange: () => void, dwellMs = OBJECT_TRACKING_DWELL_MS, maxPoints = MAX_ACQUIRED_POINTS) {
    this.scheduler = scheduler;
    this.onChange = onChange;
    this.dwellMs = dwellMs;
    this.maxPoints = maxPoints;
  }

  /** いま取得している点(変わるたびに、新しい配列になる) */
  get points(): readonly Point2D[] {
    return this.acquired;
  }

  /**
   * カーソルが、取得できる吸着点の上にあるとき、その点を渡す(無ければ null)。
   * 同じ点の上にいる間は、とどめ時間の計測を続け、時間が来たら1回だけ、取得(取得済みなら解除)する。
   * 別の点に移ったら、計測をやり直す。null なら、計測をやめる(取得済みの点は、残る)。
   */
  update(candidate: Point2D | null): void {
    if (candidate === null) {
      this.clearDwell();
      return;
    }
    if (this.candidate !== null && isSamePoint(this.candidate, candidate)) return;
    this.clearDwell();
    this.candidate = candidate;
    this.timer = this.scheduler.setTimeout(() => this.fire(candidate), this.dwellMs);
  }

  /** とどめ時間の計測をやめる(取得済みの点は、残る) */
  clearDwell(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    this.candidate = null;
  }

  /** 取得した点を、すべて捨てる(計測もやめる) */
  clear(): void {
    this.clearDwell();
    if (this.acquired.length === 0) return;
    this.acquired = [];
    this.onChange();
  }

  private fire(target: Point2D): void {
    // 候補は残す(同じ点の上にいる間に、また取得しないため)
    this.timer = null;
    const existing = this.acquired.findIndex((point) => isSamePoint(point, target));
    if (existing >= 0) {
      this.acquired = this.acquired.filter((_, index) => index !== existing);
    } else {
      const next = [...this.acquired, target];
      this.acquired = next.length > this.maxPoints ? next.slice(next.length - this.maxPoints) : next;
    }
    this.onChange();
  }
}
