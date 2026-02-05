import { describe, it, expect } from "vitest";
import { sanitizeError } from "../../src/utils/logging.js";

describe("sanitizeError", () => {
  it("returns name/message/code for Error with code", () => {
    const err = new Error("boom") as Error & { code: string };
    err.code = "E_TEST";
    const result = sanitizeError(err);
    expect(result).toEqual({ name: "Error", message: "boom", code: "E_TEST" });
  });

  it("returns name/message without code when absent", () => {
    const err = new Error("no-code");
    const result = sanitizeError(err);
    expect(result).toEqual({ name: "Error", message: "no-code", code: undefined });
  });

  it("passes through string errors", () => {
    expect(sanitizeError("fail")).toBe("fail");
  });

  it("returns generic string for unknown non-string errors", () => {
    expect(sanitizeError({ foo: "bar" })).toBe("Unknown error");
  });
});
