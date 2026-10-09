import { applyWhatsAppStatuses, verifyWhatsAppSignature } from "@/server/platform/whatsapp-webhook";

/** Vérification de l'abonnement au webhook (Meta). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token)
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

/** Statuts des messages envoyés : envoyé, remis, lu, échec. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyWhatsAppSignature(raw, request.headers.get("x-hub-signature-256")))
    return new Response("Invalid signature", { status: 401 });
  try {
    await applyWhatsAppStatuses(JSON.parse(raw));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  return new Response("OK");
}
