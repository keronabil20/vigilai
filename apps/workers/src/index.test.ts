import { describe, expect, it } from "vitest";
import { evaluateCondition } from "@vigilai/shared";

describe("workers shared helpers", () => {
  it("uses shared evaluateCondition", () => {
    expect(evaluateCondition(95, ">", 90)).toBe(true);
  });
});
