import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaWhatsAppProvider, templateParam } from "@/server/adapters/whatsapp";

afterEach(() => vi.unstubAllGlobals());

describe("WhatsApp Business (Meta)", () => {
  it("nettoie les variables de modèle (pas de retour à la ligne, longueur limitée)", () => {
    expect(templateParam("Absence\n\nAminata   était\tabsente", 100)).toBe("Absence Aminata était absente");
    expect(templateParam("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("envoie les notifications via le modèle approuvé, dans la langue du destinataire", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.123" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MetaWhatsAppProvider("PHONE_ID", "TOKEN", "lakol_notification", ["fr", "en"]);
    const result = await provider.sendNotification({
      to: "+22370000001",
      title: "Absence — Aminata",
      body: "Aminata a été marquée absente\nce matin.",
      link: "https://lakol.ml/fr/les-etoiles/attendance",
      locale: "en",
    });
    expect(result.providerMessageId).toBe("wamid.123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/PHONE_ID/messages");
    expect(init.headers.Authorization).toBe("Bearer TOKEN");
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({
      messaging_product: "whatsapp",
      to: "22370000001",
      type: "template",
      template: { name: "lakol_notification", language: { code: "en" } },
    });
    expect(payload.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "Absence — Aminata",
      "Aminata a été marquée absente ce matin.",
      "https://lakol.ml/fr/les-etoiles/attendance",
    ]);
  });

  it("une langue sans modèle approuvé utilise la langue par défaut ; une erreur Meta est remontée", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("template not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MetaWhatsAppProvider("P", "T", "lakol_notification", ["fr"]);
    await expect(
      provider.sendNotification({ to: "+22370000001", title: "t", body: "b", locale: "bm" }),
    ).rejects.toThrow("WhatsApp 404");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).template.language.code).toBe("fr");
  });
});
