import { describe, it, expect } from "bun:test";
import { draftToSave } from "./SaveOnBlurInput";

describe("draftToSave", () => {
  it("saves nothing when the field wasn't edited", () => {
    expect(draftToSave(null, "main")).toBeNull();
  });

  it("saves nothing when the trimmed draft is the saved value", () => {
    expect(draftToSave("  main ", "main")).toBeNull();
  });

  it("saves the trimmed draft when it changed", () => {
    expect(draftToSave(" sprint ", "main")).toBe("sprint");
  });

  it("saves an empty string when the field was cleared", () => {
    expect(draftToSave("   ", "main")).toBe("");
  });
});
