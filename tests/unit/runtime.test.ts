import { describe, expect, it } from "vitest";
import { detectRuntimeMode } from "../../app/src/runtime";

describe("TST-RUNTIME-01/02 runtime mode", () => {
  it("file: and content: are LOCAL_FILE", () => {
    expect(detectRuntimeMode("file:")).toBe("LOCAL_FILE");
    expect(detectRuntimeMode("content:")).toBe("LOCAL_FILE");
  });
  it("https: is HTTPS_GUEST", () => expect(detectRuntimeMode("https:")).toBe("HTTPS_GUEST"));
  it("http: only on localhost is dev", () => {
    expect(detectRuntimeMode("http:", "localhost")).toBe("LOCALHOST_DEV");
    expect(detectRuntimeMode("http:", "example.com")).toBe("UNSUPPORTED");
  });
});
