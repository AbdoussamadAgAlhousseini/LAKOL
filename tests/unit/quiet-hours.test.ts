import { describe, expect, it } from "vitest";
import { quietDelayMs } from "@/server/services/notify";

const school = { timezone: "Africa/Bamako", quietHoursStart: 20, quietHoursEnd: 7 };
const at = (iso: string) => new Date(iso);

describe("heures calmes", () => {
  it("pas de délai en journée", () => {
    expect(quietDelayMs(school, at("2026-10-09T10:00:00Z"))).toBe(0);
    expect(quietDelayMs(school, at("2026-10-09T19:59:00Z"))).toBe(0);
  });
  it("le soir, envoi différé à 7 h le lendemain", () => {
    expect(quietDelayMs(school, at("2026-10-09T22:30:00Z"))).toBe(8.5 * 3_600_000);
  });
  it("la nuit, envoi différé à 7 h le jour même", () => {
    expect(quietDelayMs(school, at("2026-10-10T05:00:00Z"))).toBe(2 * 3_600_000);
  });
  it("heures calmes désactivées si début = fin", () => {
    expect(quietDelayMs({ ...school, quietHoursStart: 0, quietHoursEnd: 0 }, at("2026-10-10T02:00:00Z"))).toBe(0);
  });
  it("respecte le fuseau de l'école", () => {
    // 21 h à Paris (UTC+2 en octobre) = 19 h UTC : heures calmes à Paris
    expect(quietDelayMs({ ...school, timezone: "Europe/Paris" }, at("2026-10-09T19:00:00Z"))).toBe(10 * 3_600_000);
  });
});
