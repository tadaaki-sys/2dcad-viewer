import { describe, expect, it } from "vitest";
import { MAX_ACQUIRED_POINTS, OBJECT_TRACKING_DWELL_MS, ObjectTrackingAcquirer } from "./acquisition";
import type { Scheduler } from "./acquisition";

/** 仮想の時計。advance で時間を進めると、時間が来たコールバックが、順に動く */
class FakeClock implements Scheduler {
  now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  get pending(): number {
    return this.tasks.size;
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.tasks.entries()].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      this.tasks.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = target;
  }
}

function setup() {
  const clock = new FakeClock();
  let changes = 0;
  const acquirer = new ObjectTrackingAcquirer(clock, () => {
    changes++;
  });
  return { clock, acquirer, changes: () => changes };
}

const P1 = { x: 10, y: 20 };
const P2 = { x: 30, y: 40 };
const P3 = { x: 50, y: 60 };
const P4 = { x: 70, y: 80 };

describe("dwell time", () => {
  it("acquires only once the cursor has stayed for the dwell time (299 ms: not yet; 300 ms: acquired)", () => {
    const { clock, acquirer, changes } = setup();
    expect(OBJECT_TRACKING_DWELL_MS).toBe(300);
    acquirer.update(P1);
    clock.advance(299);
    expect(acquirer.points).toEqual([]);
    expect(changes()).toBe(0);
    clock.advance(1);
    expect(acquirer.points).toEqual([P1]);
    expect(changes()).toBe(1);
  });

  it("leaving the snap point before the dwell time cancels it", () => {
    const { clock, acquirer } = setup();
    acquirer.update(P1);
    clock.advance(299);
    acquirer.update(null);
    expect(clock.pending).toBe(0);
    clock.advance(1000);
    expect(acquirer.points).toEqual([]);
  });

  it("moving to another snap point restarts the measurement from that moment", () => {
    const { clock, acquirer } = setup();
    acquirer.update(P1);
    clock.advance(200);
    acquirer.update(P2);
    clock.advance(200); // P1 から 400 ms だが、P2 からは 200 ms
    expect(acquirer.points).toEqual([]);
    clock.advance(100);
    expect(acquirer.points).toEqual([P2]);
  });

  it("the same point reported again (also with a tiny coordinate difference) does not restart the measurement", () => {
    const { clock, acquirer } = setup();
    acquirer.update(P1);
    clock.advance(200);
    acquirer.update({ x: 10.0000000001, y: 20 }); // 同じ交点が、別の線分の組から、わずかに違う座標で返った
    clock.advance(100);
    expect(acquirer.points).toEqual([P1]);
  });

  it("staying on the same point after it is acquired does not toggle it again", () => {
    const { clock, acquirer, changes } = setup();
    acquirer.update(P1);
    clock.advance(300);
    acquirer.update(P1);
    acquirer.update({ x: 10.0000000001, y: 20 });
    clock.advance(10_000);
    expect(acquirer.points).toEqual([P1]);
    expect(changes()).toBe(1);
  });
});

describe("acquiring, releasing and the maximum", () => {
  function acquire(clock: FakeClock, acquirer: ObjectTrackingAcquirer, point: { x: number; y: number }) {
    acquirer.update(point);
    clock.advance(300);
    acquirer.update(null); // 点を離れる
  }

  it("coming back to an acquired point and staying again releases it", () => {
    const { clock, acquirer } = setup();
    acquire(clock, acquirer, P1);
    expect(acquirer.points).toEqual([P1]);
    acquire(clock, acquirer, P1);
    expect(acquirer.points).toEqual([]);
    acquire(clock, acquirer, P1);
    expect(acquirer.points).toEqual([P1]);
  });

  it("the fourth point drops the oldest one", () => {
    const { clock, acquirer } = setup();
    expect(MAX_ACQUIRED_POINTS).toBe(3);
    for (const point of [P1, P2, P3]) acquire(clock, acquirer, point);
    expect(acquirer.points).toEqual([P1, P2, P3]);
    acquire(clock, acquirer, P4);
    expect(acquirer.points).toEqual([P2, P3, P4]);
  });

  it("releasing one of several keeps the others in order", () => {
    const { clock, acquirer } = setup();
    for (const point of [P1, P2, P3]) acquire(clock, acquirer, point);
    acquire(clock, acquirer, P2);
    expect(acquirer.points).toEqual([P1, P3]);
  });

  it("every change gives a new array (the one handed out earlier is not modified)", () => {
    const { clock, acquirer } = setup();
    acquire(clock, acquirer, P1);
    const before = acquirer.points;
    acquire(clock, acquirer, P2);
    expect(before).toEqual([P1]);
    expect(acquirer.points).toEqual([P1, P2]);
    expect(acquirer.points).not.toBe(before);
  });
});

describe("clearing (OTRACK off, a point picked, a measurement point confirmed, mouse out, pan)", () => {
  it("clear() drops the acquired points and cancels a pending acquisition, telling once", () => {
    const { clock, acquirer, changes } = setup();
    acquirer.update(P1);
    clock.advance(300);
    acquirer.update(P2); // P2 の計測の途中
    clock.advance(100);
    const before = changes();
    acquirer.clear();
    expect(acquirer.points).toEqual([]);
    expect(changes()).toBe(before + 1);
    expect(clock.pending).toBe(0);
    clock.advance(1000);
    expect(acquirer.points).toEqual([]); // 古いタイマーが、あとから取得しない
  });

  it("clear() with nothing acquired does not notify, but still cancels a pending acquisition", () => {
    const { clock, acquirer, changes } = setup();
    acquirer.update(P1);
    clock.advance(299);
    acquirer.clear();
    expect(changes()).toBe(0);
    clock.advance(1000);
    expect(acquirer.points).toEqual([]);
  });

  it("clearDwell() keeps what is already acquired (leaving the canvas / panning does not forget it)", () => {
    const { clock, acquirer } = setup();
    acquirer.update(P1);
    clock.advance(300);
    acquirer.update(P2);
    clock.advance(100);
    acquirer.clearDwell();
    clock.advance(1000);
    expect(acquirer.points).toEqual([P1]);
  });

  it("after clearDwell the same point can be acquired again (a fresh measurement starts)", () => {
    const { clock, acquirer } = setup();
    acquirer.update(P1);
    clock.advance(100);
    acquirer.clearDwell();
    acquirer.update(P1);
    clock.advance(299);
    expect(acquirer.points).toEqual([]);
    clock.advance(1);
    expect(acquirer.points).toEqual([P1]);
  });
});
