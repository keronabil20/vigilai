import { describe, expect, it } from "vitest";
import { generateAgentToken, hashToken, isPrivateOrMetadataUrl } from "./crypto.js";

describe("tokens", () => {
  it("hashes stably", () => {
    const { token, hash } = generateAgentToken();
    expect(hashToken(token)).toBe(hash);
    expect(token.startsWith("vag_")).toBe(true);
  });
});

describe("isPrivateOrMetadataUrl", () => {
  it("blocks private ranges and metadata", () => {
    expect(isPrivateOrMetadataUrl("http://127.0.0.1/x")).toBe(true);
    expect(isPrivateOrMetadataUrl("http://169.254.169.254/latest")).toBe(true);
    expect(isPrivateOrMetadataUrl("http://10.0.0.1/hook")).toBe(true);
    expect(isPrivateOrMetadataUrl("https://hooks.slack.com/services/x")).toBe(
      false,
    );
  });
});
