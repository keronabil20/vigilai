import { describe, expect, it } from "vitest";
import { collectMemUsedPct, parseArgs, AGENT_VERSION } from "./collect.js";

describe("agent", () => {
  it("has version", () => {
    expect(AGENT_VERSION).toBe("0.1.0");
  });

  it("parses args", () => {
    expect(parseArgs(["--token", "abc", "--url", "http://x", "--interval", "15"])).toEqual({
      token: "abc",
      url: "http://x",
      interval: 15,
    });
  });

  it("collects memory pct", () => {
    const m = collectMemUsedPct();
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThanOrEqual(100);
  });
});
