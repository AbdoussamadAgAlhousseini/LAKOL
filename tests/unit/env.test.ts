import { describe, expect, it } from "vitest";
import { checkEnv } from "@/server/env";

const PROD = {
  DATABASE_URL: "postgresql://x",
  REDIS_URL: "redis://redis:6379",
  APP_URL: "https://lakol.ml",
  ROOT_DOMAIN: "lakol.ml",
  WHATSAPP_PROVIDER: "meta",
  WHATSAPP_PHONE_NUMBER_ID: "123",
  WHATSAPP_ACCESS_TOKEN: "token",
  WHATSAPP_TEMPLATE_NAME: "lakol_notification",
  WHATSAPP_APP_SECRET: "secret",
  WHATSAPP_VERIFY_TOKEN: "verify",
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_x",
  EMAIL_FROM: "LAKOL <no-reply@lakol.ml>",
  STORAGE_PROVIDER: "s3",
  S3_BUCKET: "lakol",
  S3_ACCESS_KEY_ID: "a",
  S3_SECRET_ACCESS_KEY: "b",
};

describe("configuration de production", () => {
  it("une configuration complète ne remonte ni erreur ni avertissement", () => {
    expect(checkEnv(PROD)).toEqual({ errors: [], warnings: [] });
  });

  it("signale les oublis bloquants", () => {
    const { errors } = checkEnv({
      ...PROD,
      APP_URL: "http://lakol.ml",
      WHATSAPP_TEMPLATE_NAME: "",
      RESEND_API_KEY: undefined,
    });
    expect(errors.join("\n")).toMatch(/APP_URL doit commencer par https/);
    expect(errors.join("\n")).toMatch(/WHATSAPP_TEMPLATE_NAME/);
    expect(errors.join("\n")).toMatch(/RESEND_API_KEY/);
  });

  it("avertit quand les envois sont simulés ou le stockage local", () => {
    const { errors, warnings } = checkEnv({ ...PROD, WHATSAPP_PROVIDER: "mock", STORAGE_PROVIDER: "local" });
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toMatch(/aucun WhatsApp/);
    expect(warnings.join("\n")).toMatch(/volume persistant/);
  });

  it("le worker n'a pas besoin des secrets du webhook", () => {
    expect(checkEnv({ ...PROD, WHATSAPP_APP_SECRET: "", WHATSAPP_VERIFY_TOKEN: "" }, "worker").errors).toEqual([]);
  });
});
