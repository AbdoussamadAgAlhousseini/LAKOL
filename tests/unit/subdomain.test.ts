import { describe, expect, it } from "vitest";
import { schoolFromHost } from "@/lib/subdomain";

describe("sous-domaines", () => {
  it("reconnaît l'école dans l'hôte", () => {
    expect(schoolFromHost("les-etoiles.lakol.ml", "lakol.ml")).toBe("les-etoiles");
    expect(schoolFromHost("Les-Etoiles.LAKOL.ml:443", "lakol.ml")).toBe("les-etoiles");
  });
  it("ignore le domaine principal, les sous-domaines techniques et les autres domaines", () => {
    expect(schoolFromHost("lakol.ml", "lakol.ml")).toBeNull();
    expect(schoolFromHost("www.lakol.ml", "lakol.ml")).toBeNull();
    expect(schoolFromHost("a.b.lakol.ml", "lakol.ml")).toBeNull();
    expect(schoolFromHost("les-etoiles.autre.ml", "lakol.ml")).toBeNull();
    expect(schoolFromHost("localhost:3000", undefined)).toBeNull();
  });
});
