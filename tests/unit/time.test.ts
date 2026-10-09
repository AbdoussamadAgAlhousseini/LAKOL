import { describe, expect, it } from "vitest";
import { formatTime, isoDay, overlaps, parseTime, weekStart } from "@/lib/time";

describe("heures", () => {
  it("convertit minutes et HH:MM", () => {
    expect(formatTime(510)).toBe("08:30");
    expect(parseTime("08:30")).toBe(510);
    expect(parseTime("25:00")).toBeNull();
  });
  it("détecte les chevauchements, pas les créneaux qui se suivent", () => {
    expect(overlaps({ startMin: 480, endMin: 540 }, { startMin: 530, endMin: 600 })).toBe(true);
    expect(overlaps({ startMin: 480, endMin: 540 }, { startMin: 540, endMin: 600 })).toBe(false);
  });
  it("calcule le jour ISO et le lundi de la semaine", () => {
    const thursday = new Date("2026-10-08T10:00:00Z");
    expect(isoDay(thursday)).toBe(4);
    expect(weekStart(thursday).toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(isoDay(new Date("2026-10-11T00:00:00Z"))).toBe(7);
  });
});
