import { describe, expect, it } from "vitest";
import { fittedOutput } from "./render";
describe("headless fitted output", () => {
  it("fits extreme bounds without exceeding side/pixel limits", () => {
    for (const [width, height] of [
      [1, 1],
      [2e6, 2e6],
      [2e6, 1],
      [1, 2e6],
      [600, 900],
    ]) {
      const result = fittedOutput({ x: -1e6, y: -1e6, width: width!, height: height! });
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2048);
      expect(result.width * result.height).toBeLessThanOrEqual(2097152);
    }
  });
  it("offers larger download profiles without changing the agent bounds", () => {
    const bounds = { x: 0, y: 0, width: 500, height: 400 };
    expect(fittedOutput(bounds, 1, "high").width).toBe(
      fittedOutput(bounds, 1, "standard").width * 2,
    );
    const large = { x: 0, y: 0, width: 6000, height: 6000 };
    expect(fittedOutput(large, 1, "high").width).toBe(4096);
    expect(fittedOutput(large, 1, "standard").width).toBe(2048);
    const agent = fittedOutput(large);
    expect(agent.width * agent.height).toBeLessThanOrEqual(2097152);
  });
  it("applies byte-downscaling after fitting and rejects invalid scales", () => {
    const bounds = { x: 0, y: 0, width: 5000, height: 5000 };
    expect(fittedOutput(bounds, 0.5).zoom).toBe(fittedOutput(bounds).zoom * 0.5);
    for (const scale of [0, -1, Infinity, NaN, 2])
      expect(() => fittedOutput(bounds, scale)).toThrow();
  });
});
