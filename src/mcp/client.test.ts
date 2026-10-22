import { describe, expect, it } from "bun:test";
import { toolResult } from "./client";

describe("toolResult", () => {
  it("returns the body's value as JSON text", async () => {
    expect(await toolResult(async () => ({ deleted: 3 }))).toEqual({ content: [{ type: "text", text: '{"deleted":3}' }] });
  });

  it("turns an empty value into null, so the text is always JSON", async () => {
    expect(await toolResult(async () => undefined)).toEqual({ content: [{ type: "text", text: "null" }] });
  });

  it("turns a throw into an error result", async () => {
    expect(await toolResult(() => Promise.reject(new Error("Task 9 not found")))).toEqual({
      content: [{ type: "text", text: "Error: Task 9 not found" }],
      isError: true,
    });
    expect(await toolResult(() => Promise.reject("boom"))).toEqual({
      content: [{ type: "text", text: "Error: boom" }],
      isError: true,
    });
  });
});
