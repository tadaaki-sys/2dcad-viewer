import { describe, expect, it } from "vitest";
import { THIN_LINE_WEIGHT_LIMIT, lineWeightToScreenWidthPx } from "./lineWeight";

describe("lineWeightToScreenWidthPx", () => {
  it("keeps the common thin weights at 1 px", () => {
    for (const weight of [13, 18, 20, 25]) expect(lineWeightToScreenWidthPx(weight)).toBe(1);
  });

  it("draws heavier weights wider, in 0.5 px steps", () => {
    expect(lineWeightToScreenWidthPx(50)).toBe(2); // 0.50mm = 1.89px
    expect(lineWeightToScreenWidthPx(70)).toBe(2.5); // 0.70mm = 2.65px
    expect(lineWeightToScreenWidthPx(100)).toBe(4); // 1.00mm = 3.78px
    expect(lineWeightToScreenWidthPx(211)).toBe(8); // 2.11mm = 7.97px
  });

  it("treats invalid or default markers as a thin line", () => {
    expect(lineWeightToScreenWidthPx(-3)).toBe(1);
    expect(lineWeightToScreenWidthPx(-1)).toBe(1);
    expect(lineWeightToScreenWidthPx(0)).toBe(1);
    expect(lineWeightToScreenWidthPx(Number.NaN)).toBe(1);
  });

  it("uses a thin-line limit that never changes the rendered width", () => {
    expect(lineWeightToScreenWidthPx(THIN_LINE_WEIGHT_LIMIT)).toBeLessThanOrEqual(1);
  });
});
