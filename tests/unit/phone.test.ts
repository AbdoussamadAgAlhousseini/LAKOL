import { describe, expect, it } from "vitest";
import { normalizePhone, parseIdentifier } from "@/lib/phone";

describe("normalizePhone", () => {
  it("ajoute l'indicatif du Mali aux numéros locaux", () => {
    expect(normalizePhone("70 00 00 01")).toBe("+22370000001");
    expect(normalizePhone("70-00-00-01")).toBe("+22370000001");
  });
  it("accepte les formats internationaux", () => {
    expect(normalizePhone("+223 70 00 00 01")).toBe("+22370000001");
    expect(normalizePhone("0022370000001")).toBe("+22370000001");
  });
  it("utilise l'indicatif du pays donné", () => {
    expect(normalizePhone("77 123 45 67", "SN")).toBe("+221771234567");
  });
  it("rejette les saisies invalides", () => {
    expect(normalizePhone("1234")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
});

describe("parseIdentifier", () => {
  it("reconnaît un email et le met en minuscules", () => {
    expect(parseIdentifier(" Parent@Lakol.TEST ")).toEqual({ kind: "email", value: "parent@lakol.test" });
  });
  it("reconnaît un téléphone", () => {
    expect(parseIdentifier("70000001")).toEqual({ kind: "phone", value: "+22370000001" });
  });
  it("reconnaît un matricule comme identifiant", () => {
    expect(parseIdentifier("ETO-25-0029")).toEqual({ kind: "username", value: "eto-25-0029" });
  });
  it("rejette un email mal formé", () => {
    expect(parseIdentifier("parent@")).toBeNull();
  });
});
