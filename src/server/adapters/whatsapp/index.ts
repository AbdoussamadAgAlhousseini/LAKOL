import { logger } from "@/server/logger";

export interface WhatsAppMessage {
  to: string; // E.164
  body: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendText(message: WhatsAppMessage): Promise<{ providerMessageId: string }>;
}

/** Développement : écrit le message dans les logs au lieu de l'envoyer. */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly sent: WhatsAppMessage[] = [];

  async sendText(message: WhatsAppMessage) {
    this.sent.push(message);
    logger.info({ channel: "whatsapp", to: message.to }, message.body);
    return { providerMessageId: `mock-${Date.now()}-${this.sent.length}` };
  }
}

/** API WhatsApp Business (Meta Cloud API). */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta";
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly apiVersion = "v21.0",
  ) {}

  async sendText({ to, body }: WhatsAppMessage) {
    const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/^\+/, ""),
        type: "text",
        text: { body, preview_url: false },
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { messages?: { id: string }[] };
    return { providerMessageId: json.messages?.[0]?.id ?? "" };
  }
}

let instance: WhatsAppProvider | undefined;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (instance) return instance;
  const { WHATSAPP_PROVIDER, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN } = process.env;
  instance =
    WHATSAPP_PROVIDER === "meta" && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN
      ? new MetaWhatsAppProvider(WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN)
      : new MockWhatsAppProvider();
  return instance;
}
