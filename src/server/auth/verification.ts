import type { User, VerificationPurpose } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getEmailProvider } from "@/server/adapters/email";
import { getWhatsAppProvider } from "@/server/adapters/whatsapp";
import { generateNumericCode, sha256 } from "./tokens";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** Crée un code à 6 chiffres et l'envoie par WhatsApp (sinon par email). */
export async function sendVerificationCode(
  user: User,
  purpose: VerificationPurpose,
): Promise<"WHATSAPP" | "EMAIL" | null> {
  const channel = user.phone ? "WHATSAPP" : user.email ? "EMAIL" : null;
  if (!channel) return null;

  const code = generateNumericCode();
  await prisma.verificationCode.updateMany({
    where: { userId: user.id, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.verificationCode.create({
    data: { userId: user.id, purpose, channel, codeHash: sha256(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });

  const text = `LAKOL : votre code de vérification est ${code}. Il expire dans 10 minutes. Ne le communiquez à personne.`;
  // Via le modèle approuvé : l'utilisateur n'a pas forcément écrit à LAKOL dans les dernières 24 h.
  if (channel === "WHATSAPP")
    await getWhatsAppProvider().sendNotification({
      to: user.phone!,
      title: "Votre code LAKOL",
      body: text,
      locale: user.locale,
    });
  else await getEmailProvider().send({ to: user.email!, subject: "Votre code LAKOL", text });
  return channel;
}

/** Vérifie et consomme le code. Chaque essai raté compte ; 5 essais au maximum. */
export async function consumeVerificationCode(
  userId: string,
  purpose: VerificationPurpose,
  code: string,
): Promise<boolean> {
  const row = await prisma.verificationCode.findFirst({
    where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row || row.attempts >= MAX_ATTEMPTS) return false;
  if (row.codeHash !== sha256(code.trim())) {
    await prisma.verificationCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  await prisma.verificationCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return true;
}
