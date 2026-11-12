import { describe, expect, it } from "vitest";
import { newEntityId, parseNewEntityCounter } from "./ids";

describe("parseNewEntityCounter", () => {
  it("reads the counter back from ids made by newEntityId", () => {
    for (const counter of [0, 1, 9, 10, 123456]) expect(parseNewEntityCounter(newEntityId(counter))).toBe(counter);
  });

  it("returns null for imported ids and anything else", () => {
    for (const id of ["e0", "e12", "n", "n01", "n-1", "n1.5", "nx", "N1", " n1", "n1 ", "", "n99999999999999999999"]) {
      expect(parseNewEntityCounter(id), id).toBeNull();
    }
  });
});
