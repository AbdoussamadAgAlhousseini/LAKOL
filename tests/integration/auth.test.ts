import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "@/server/auth/password";
import { createSession, invalidateSession, validateSessionToken } from "@/server/auth/session";
import { consumeVerificationCode, sendVerificationCode } from "@/server/auth/verification";
import { getWhatsAppProvider, MockWhatsAppProvider } from "@/server/adapters/whatsapp";
import { isLoginBlocked, recordLoginAttempt } from "@/server/auth/rate-limit";

afterAll(() => prisma.$disconnect());

describe("authentification", () => {
  it("le parent de démonstration se connecte avec son téléphone", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: "+22370000001" } });
    expect(await verifyPassword(user.passwordHash!, "Parent2025!")).toBe(true);
    expect(await verifyPassword(user.passwordHash!, "mauvais")).toBe(false);
  });

  it("une session est créée, validée puis révoquée ; le jeton brut n'est pas stocké", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: "+22370000001" } });
    const { token, session } = await createSession(user.id);
    expect(session.id).not.toBe(token);
    expect((await validateSessionToken(token))?.user.id).toBe(user.id);
    await invalidateSession(session.id);
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("un code de réinitialisation est envoyé par WhatsApp et ne sert qu'une fois", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: "+22370000001" } });
    const provider = getWhatsAppProvider() as MockWhatsAppProvider;
    expect(await sendVerificationCode(user, "PASSWORD_RESET")).toBe("WHATSAPP");
    const code = provider.sent.at(-1)!.body.match(/\d{6}/)![0];
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await consumeVerificationCode(user.id, "PASSWORD_RESET", wrong)).toBe(false);
    expect(await consumeVerificationCode(user.id, "PASSWORD_RESET", code)).toBe(true);
    expect(await consumeVerificationCode(user.id, "PASSWORD_RESET", code)).toBe(false);
  });

  it("bloque après 5 échecs pour un même identifiant", async () => {
    const identifier = `test-${Date.now()}@lakol.test`;
    for (let i = 0; i < 5; i++) await recordLoginAttempt(identifier, null, false);
    expect(await isLoginBlocked(identifier, null)).toBe(true);
    await prisma.loginAttempt.deleteMany({ where: { identifier } });
  });
});
