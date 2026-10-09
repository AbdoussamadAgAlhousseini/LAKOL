import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from "@/server/rbac/permissions";
import {
  can,
  canAll,
  canOnClass,
  canOnStudent,
  ForbiddenError,
  requireClassAccess,
  type AccessScope,
} from "@/server/rbac/policies";

function scope(
  role: keyof typeof DEFAULT_ROLE_PERMISSIONS,
  classIds: string[] = [],
  studentIds: string[] = [],
): AccessScope {
  return {
    permissions: new Set(DEFAULT_ROLE_PERMISSIONS[role]),
    classIds: new Set(classIds),
    studentIds: new Set(studentIds),
  };
}

describe("catalogue", () => {
  it("chaque rôle système n'utilise que des permissions connues", () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of DEFAULT_ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toHaveProperty([p]);
    }
  });
});

describe("professeur", () => {
  const teacher = scope("TEACHER", ["class-a"], ["student-1"]);

  it("saisit les notes de ses classes uniquement", () => {
    expect(canOnClass(teacher, "grade.write", "class-a")).toBe(true);
    expect(canOnClass(teacher, "grade.write", "class-b")).toBe(false);
    expect(() => requireClassAccess(teacher, "grade.write", "class-b")).toThrow(ForbiddenError);
  });
  it("ne valide pas les notes et ne voit pas les finances", () => {
    expect(can(teacher, "grade.validate")).toBe(false);
    expect(can(teacher, "finance.read")).toBe(false);
  });
  it("voit les élèves de ses classes, pas les autres", () => {
    expect(canOnStudent(teacher, "student.read", "student-1")).toBe(true);
    expect(canOnStudent(teacher, "student.read", "student-2")).toBe(false);
    expect(canAll(teacher, "student.read")).toBe(false);
  });
});

describe("parent", () => {
  const parent = scope("PARENT", [], ["child-1", "child-2"]);

  it("ne voit que ses propres enfants", () => {
    expect(canOnStudent(parent, "grade.read", "child-1")).toBe(true);
    expect(canOnStudent(parent, "grade.read", "other")).toBe(false);
    expect(canOnStudent(parent, "finance.read", "child-2")).toBe(true);
  });
  it("ne peut pas saisir de notes", () => {
    expect(can(parent, "grade.write")).toBe(false);
  });
});

describe("direction", () => {
  const director = scope("DIRECTOR");
  it("a accès à toute l'école", () => {
    expect(canOnClass(director, "attendance.write", "any")).toBe(true);
    expect(canOnStudent(director, "grade.read", "any")).toBe(true);
    expect(can(director, "payment.cancel")).toBe(true);
  });
});
