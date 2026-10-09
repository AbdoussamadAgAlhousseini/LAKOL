import { describe, expect, it } from "vitest";
import { scopeArgs, TenantViolationError } from "@/server/db/tenant";

const A = "school-a";

describe("scopeArgs", () => {
  it("ajoute schoolId aux filtres de lecture", () => {
    expect(scopeArgs("Student", "findMany", { where: { lastName: "Traoré" } }, A)).toEqual({
      where: { lastName: "Traoré", schoolId: A },
    });
    expect(scopeArgs("Student", "findUnique", { where: { id: "x" } }, A)).toEqual({ where: { id: "x", schoolId: A } });
  });
  it("écrase un schoolId étranger dans un filtre", () => {
    expect(scopeArgs("Student", "findMany", { where: { schoolId: "school-b" } }, A)).toEqual({
      where: { schoolId: A },
    });
  });
  it("force schoolId à la création", () => {
    expect(scopeArgs("Student", "create", { data: { firstName: "Awa" } }, A)).toEqual({
      data: { firstName: "Awa", schoolId: A },
    });
    expect(scopeArgs("Grade", "createMany", { data: [{ score: 1 }, { score: 2 }] }, A)).toEqual({
      data: [
        { score: 1, schoolId: A },
        { score: 2, schoolId: A },
      ],
    });
  });
  it("refuse d'écrire pour une autre école", () => {
    expect(() => scopeArgs("Student", "create", { data: { schoolId: "school-b" } }, A)).toThrow(TenantViolationError);
    expect(() => scopeArgs("Student", "update", { where: { id: "x" }, data: { schoolId: "school-b" } }, A)).toThrow(
      TenantViolationError,
    );
  });
  it("ne touche pas aux modèles globaux", () => {
    const args = { where: { email: "a@b.c" } };
    expect(scopeArgs("User", "findFirst", args, A)).toBe(args);
  });
});
