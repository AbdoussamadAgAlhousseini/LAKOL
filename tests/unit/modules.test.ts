import { describe, expect, it } from "vitest";
import { effectiveModules } from "@/lib/modules";
import { permissionsForModules } from "@/server/rbac/permissions";

describe("modules activables", () => {
  it("plan, désactivation par l'école, ajout par la plateforme", () => {
    const m = effectiveModules(
      ["HOMEWORK", "GRADES", "FINANCE"],
      [
        { module: "FINANCE", enabled: false, grantedByPlatform: false }, // désactivé par l'école
        { module: "MESSAGING", enabled: true, grantedByPlatform: true }, // offert par la plateforme
        { module: "CANTEEN", enabled: true, grantedByPlatform: false }, // hors plan : sans effet
      ],
    );
    expect([...m].sort()).toEqual(["GRADES", "HOMEWORK", "MESSAGING"]);
  });

  it("retire les permissions des modules inactifs et garde le socle", () => {
    const kept = permissionsForModules(
      ["student.read", "school.settings.manage", "finance.read", "finance.read:own", "grade.read:own", "message.send"],
      new Set(["GRADES"]),
    );
    expect([...kept].sort()).toEqual(["grade.read:own", "school.settings.manage", "student.read"]);
  });
});
