import { logger } from "@/server/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

/** Développement : écrit l'email dans les logs. */
export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.sent.push(message);
    logger.info({ channel: "email", to: message.to, subject: message.subject }, message.text);
    return { providerMessageId: `mock-${Date.now()}-${this.sent.length}` };
  }
}

/** Envoi via l'API HTTP de Resend. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send({ to, subject, text, html }: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to, subject, text, html }),
    });
    if (!res.ok) throw new Error(`Email ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { id?: string };
    return { providerMessageId: json.id ?? "" };
  }
}

let instance: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (instance) return instance;
  const { EMAIL_PROVIDER, RESEND_API_KEY, EMAIL_FROM } = process.env;
  instance =
    EMAIL_PROVIDER === "resend" && RESEND_API_KEY && EMAIL_FROM
      ? new ResendEmailProvider(RESEND_API_KEY, EMAIL_FROM)
      : new MockEmailProvider();
  return instance;
}
