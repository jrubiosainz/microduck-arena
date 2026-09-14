import { describe, expect, it } from "vitest";
import { describeResult, validateFile } from "./submit.js";

describe("validateFile", () => {
  it("accepts an onnx file", () => {
    expect(validateFile({ name: "p.onnx", size: 800_000 })).toBeNull();
  });

  it("asks for a file when none was chosen", () => {
    expect(validateFile(null)).toMatch(/choose/i);
  });

  it("names the extension it wants", () => {
    expect(validateFile({ name: "policy.pt", size: 1000 })).toMatch(/\.onnx/);
  });

  it("refuses an oversize file before uploading it", () => {
    // The server enforces this too; catching it here saves a 64 MB round trip.
    expect(validateFile({ name: "big.onnx", size: 65 * 1024 * 1024 })).toMatch(/larger/i);
  });

  it("accepts a file of exactly the limit and refuses one byte more", () => {
    // Pins the boundary against the server's `> MAX_MODEL_BYTES`. A `>=` here
    // would reject a file the server would have accepted.
    const limit = 64 * 1024 * 1024;
    expect(validateFile({ name: "edge.onnx", size: limit })).toBeNull();
    expect(validateFile({ name: "edge.onnx", size: limit + 1 })).toMatch(/larger/i);
  });

  it("accepts an uppercase extension", () => {
    // Windows and some export tools produce .ONNX; rejecting it would be a
    // baffling refusal of a perfectly good file.
    expect(validateFile({ name: "POLICY.ONNX", size: 1000 })).toBeNull();
  });
});

describe("describeResult", () => {
  it("reports the score, the speed it was set at, and how many seeds finished", () => {
    expect(
      describeResult({
        score: 11.724,
        command_vx: 0.4,
        seeds_finished: 5,
        seeds_total: 5,
        policy_name: "walker",
      }),
    ).toBe("walker: 11.724s at 0.40 m/s · 5/5 finished");
  });

  it("omits the speed clause entirely rather than saying 'at — m/s'", () => {
    // A record from before the sweep has no speed. The sentence has to stay a
    // sentence.
    expect(
      describeResult({ score: 18.216, seeds_finished: 5, seeds_total: 5, policy_name: "walker" }),
    ).toBe("walker: 18.216s · 5/5 finished");
  });

  it("says DNF rather than quoting the time limit, and names no speed", () => {
    expect(
      describeResult({
        score: 50,
        command_vx: 0.9,
        seeds_finished: 0,
        seeds_total: 5,
        policy_name: "roulade",
      }),
    ).toBe("roulade: DNF · 0/5 finished");
  });
});
