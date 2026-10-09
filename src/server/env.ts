// Vérification de la configuration au démarrage (application et worker).
// En production (DEPLOY_ENV=production), une erreur arrête le démarrage avec un
// message clair ; ailleurs, tout est signalé dans les logs sans bloquer.
// Pas de "server-only" : le worker l'utilise aussi.
import { logger } from "./logger";

type Env = Record<string, string | undefined>;

export interface EnvReport {
  errors: string[];
  warnings: string[];
}

export function checkEnv(env: Env, role: "app" | "worker" = "app"): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const required = (key: string, why: string) => {
    if (!env[key]?.trim()) errors.push(`${key} manquant : ${why}`);
  };

  required("DATABASE_URL", "connexion PostgreSQL");
  required("REDIS_URL", "file des tâches (envois WhatsApp/email, rappels, abonnements)");
  required("APP_URL", "adresse publique utilisée dans les messages");
  if (env.APP_URL && !env.APP_URL.startsWith("https://"))
    errors.push("APP_URL doit commencer par https:// (cookies sécurisés, liens envoyés aux parents)");
  if (env.JOBS_INLINE === "1") warnings.push("JOBS_INLINE=1 : les tâches s'exécutent dans la requête (développement)");

  // WhatsApp : canal principal des parents.
  if (env.WHATSAPP_PROVIDER === "meta") {
    required("WHATSAPP_PHONE_NUMBER_ID", "numéro WhatsApp Business (Meta)");
    required("WHATSAPP_ACCESS_TOKEN", "jeton d'accès permanent de l'application Meta");
    required("WHATSAPP_TEMPLATE_NAME", "modèle de message approuvé par Meta (messages hors fenêtre de 24 h)");
    if (role === "app") {
      required("WHATSAPP_APP_SECRET", "vérification de la signature du webhook des statuts");
      required("WHATSAPP_VERIFY_TOKEN", "vérification de l'abonnement au webhook");
    }
  } else {
    warnings.push("WHATSAPP_PROVIDER n'est pas « meta » : aucun WhatsApp n'est réellement envoyé");
  }

  if (env.EMAIL_PROVIDER === "resend") {
    required("RESEND_API_KEY", "envoi des emails");
    required("EMAIL_FROM", "expéditeur des emails (domaine vérifié chez Resend)");
  } else {
    warnings.push("EMAIL_PROVIDER n'est pas « resend » : aucun email n'est réellement envoyé");
  }

  if (env.STORAGE_PROVIDER === "s3") {
    for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) required(key, "stockage S3");
  } else {
    warnings.push(
      `Stockage local (${env.STORAGE_DIR ?? "./storage"}) : ce dossier doit être un volume persistant et sauvegardé`,
    );
  }
  if (role === "app" && !env.ROOT_DOMAIN) warnings.push("ROOT_DOMAIN vide : accès par sous-domaine désactivé");
  return { errors, warnings };
}

/** Vérifie la configuration ; en production, arrête le processus si elle est incomplète. */
export function assertEnv(role: "app" | "worker") {
  const strict = process.env.DEPLOY_ENV === "production";
  const { errors, warnings } = checkEnv(process.env, role);
  for (const w of warnings) logger.warn({ role }, `configuration : ${w}`);
  if (errors.length === 0) return;
  for (const e of errors) logger[strict ? "error" : "warn"]({ role }, `configuration : ${e}`);
  if (strict) {
    logger.error({ role }, "configuration de production incomplète : arrêt (voir DEPLOIEMENT.md)");
    process.exit(1);
  }
}
