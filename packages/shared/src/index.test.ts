import { describe, expect, it } from "vitest";
import {
  alertFingerprint,
  compareSemver,
  evaluateCondition,
  hostStatusFromLastSeen,
  PLAN_LIMITS,
} from "./index.js";

describe("evaluateCondition", () => {
  it("evaluates operators", () => {
    expect(evaluateCondition(90, ">", 80)).toBe(true);
    expect(evaluateCondition(80, ">", 80)).toBe(false);
    expect(evaluateCondition(80, ">=", 80)).toBe(true);
    expect(evaluateCondition(70, "<", 80)).toBe(true);
    expect(evaluateCondition(80, "==", 80)).toBe(true);
  });
});

describe("hostStatusFromLastSeen", () => {
  const now = new Date("2026-07-27T12:00:00Z");

  it("returns pending when never seen", () => {
    expect(hostStatusFromLastSeen(null, now)).toBe("pending");
  });

  it("returns online when recent", () => {
    const last = new Date(now.getTime() - 60_000);
    expect(hostStatusFromLastSeen(last, now)).toBe("online");
  });

  it("returns stale then offline", () => {
    expect(
      hostStatusFromLastSeen(new Date(now.getTime() - 5 * 60_000), now),
    ).toBe("stale");
    expect(
      hostStatusFromLastSeen(new Date(now.getTime() - 15 * 60_000), now),
    ).toBe("offline");
  });
});

describe("alertFingerprint", () => {
  it("is stable", () => {
    expect(alertFingerprint("h1", "r1", "cpu")).toBe("h1:r1:cpu");
  });
});

describe("compareSemver", () => {
  it("compares versions", () => {
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
    expect(compareSemver("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0", "0.2.0")).toBeLessThan(0);
  });
});

describe("PLAN_LIMITS", () => {
  it("has free/pro/business", () => {
    expect(PLAN_LIMITS.free.maxHosts).toBe(2);
    expect(PLAN_LIMITS.pro.maxHosts).toBe(25);
    expect(PLAN_LIMITS.business.retentionDays).toBe(90);
  });
});
