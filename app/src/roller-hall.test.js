import { describe, expect, it } from "vitest";
import { rollerSeats } from "./roller-hall.js";

describe("roller arena seating", () => {
  it.each([0.85, 3.4, 6.8])(
    "keeps the crowd outside a %sm course and the judges' apron",
    (span) => {
      const seats = rollerSeats(2, span);
      expect(seats.length).toBeGreaterThan(250);
      expect(new Set(seats.map((s) => s.y)).size).toBe(6);
      for (const s of seats) {
        expect(s.x < -0.4 || s.x > 2.4 || Math.abs(s.z) > span / 2 + 0.75).toBe(
          true,
        );
        // A spectator's +X front faces the centre, without changing robot scale.
        const facing = Math.cos(s.yaw) * (1 - s.x) - Math.sin(s.yaw) * -s.z;
        expect(facing).toBeGreaterThan(0);
      }
    },
  );
});
