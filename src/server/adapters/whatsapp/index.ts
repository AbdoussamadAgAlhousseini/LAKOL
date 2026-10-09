import { logger } from "@/server/logger";

export interface WhatsAppMessage {
  to: string; // E.164
  body: string;
}

/** Notification de l'école : envoyée via le modèle approuvé par Meta. */
export interface WhatsAppNotification {
  to: string; // E.164
  title: string;
  body: string;
  /** Lien complet vers la page concernée (https://…). */
  link?: string | null;
  /** Langue du destinataire (fr, en…). */
  locale?: string | null;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendText(message: WhatsAppMessage): Promise<{ providerMessageId: string }>;
  sendNotification(notification: WhatsAppNotification): Promise<{ providerMessageId: string }>;
}

/** Texte complet d'une notification (simulation, et repli en texte libre). */
export function notificationText({ title, body, link }: WhatsAppNotification) {
  return `${title}\n\n${body}${link ? `\n\n${link}` : ""}`;
}

/**
 * Paramètre de modèle WhatsApp : Meta refuse les retours à la ligne, les
 * tabulations et plus de 4 espaces consécutifs dans les variables.
 */
export function templateParam(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
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

  async sendNotification(notification: WhatsAppNotification) {
    return this.sendText({ to: notification.to, body: notificationText(notification) });
  }
}

/** API WhatsApp Business (Meta Cloud API). */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta";
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    /** Modèle « utilitaire » approuvé : {{1}} titre, {{2}} message, {{3}} lien (voir DEPLOIEMENT.md). */
    private readonly templateName: string,
    /** Langues dans lesquelles le modèle est approuvé ; la première sert par défaut. */
    private readonly templateLanguages: string[] = ["fr"],
    private readonly apiVersion = "v21.0",
  ) {}

  private async post(payload: Record<string, unknown>) {
    const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { messages?: { id: string }[] };
    return { providerMessageId: json.messages?.[0]?.id ?? "" };
  }

  /** Texte libre : accepté par Meta seulement dans les 24 h qui suivent un message du destinataire. */
  async sendText({ to, body }: WhatsAppMessage) {
    return this.post({ to: to.replace(/^\+/, ""), type: "text", text: { body, preview_url: false } });
  }

  /** Notification : toujours via le modèle approuvé (l'école écrit en premier, hors fenêtre de 24 h). */
  async sendNotification(n: WhatsAppNotification) {
    const language = this.templateLanguages.find((l) => l === n.locale) ?? this.templateLanguages[0];
    return this.post({
      to: n.to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: this.templateName,
        language: { code: language },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: templateParam(n.title, 120) },
              { type: "text", text: templateParam(n.body, 700) },
              { type: "text", text: templateParam(n.link ?? process.env.APP_URL ?? "LAKOL", 200) },
            ],
          },
        ],
      },
    });
  }
}

let instance: WhatsAppProvider | undefined;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (instance) return instance;
  const { WHATSAPP_PROVIDER, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_TEMPLATE_NAME } = process.env;
  instance =
    WHATSAPP_PROVIDER === "meta" && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN && WHATSAPP_TEMPLATE_NAME
      ? new MetaWhatsAppProvider(
          WHATSAPP_PHONE_NUMBER_ID,
          WHATSAPP_ACCESS_TOKEN,
          WHATSAPP_TEMPLATE_NAME,
          (process.env.WHATSAPP_TEMPLATE_LANGUAGES ?? "fr")
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean),
        )
      : new MockWhatsAppProvider();
  return instance;
}
