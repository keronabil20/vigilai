import { describe, expect, it } from "vitest";
import {
  alertFingerprint,
  anomalyFingerprint,
  compareSemver,
  evaluateCondition,
  hostStatusFromLastSeen,
  PLAN_LIMITS,
  roleAllowed,
  updateEwma,
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
    expect(anomalyFingerprint("h1", "cpu.usage_pct")).toBe(
      "h1:anomaly:cpu.usage_pct",
    );
  });
});

describe("updateEwma", () => {
  it("starts with zscore 0", () => {
    const a = updateEwma(null, 50);
    expect(a.state.ewma).toBe(50);
    expect(a.zscore).toBe(0);
  });

  it("detects spike after warm-up", () => {
    let state = updateEwma(null, 50).state;
    for (let i = 0; i < 40; i++) {
      // tiny noise so variance is non-zero
      state = updateEwma(state, 50 + (i % 3) * 0.01).state;
    }
    const spike = updateEwma(state, 200);
    expect(spike.zscore).toBeGreaterThan(3);
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
  it("has log retention", () => {
    expect(PLAN_LIMITS.free.logRetentionDays).toBe(3);
    expect(PLAN_LIMITS.pro.maxHosts).toBe(25);
  });
});

describe("roleAllowed", () => {
  it("checks roles", () => {
    expect(roleAllowed("readonly", ["owner", "admin"])).toBe(false);
    expect(roleAllowed("admin", ["owner", "admin"])).toBe(true);
  });
});
