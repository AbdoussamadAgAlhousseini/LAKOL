// Journalisation JSON minimale (une ligne par événement), lisible par les
// collecteurs de logs des hébergeurs. Pas de données sensibles dans `meta`.

type Meta = Record<string, unknown>;

function write(level: "info" | "warn" | "error", meta: Meta, message: string) {
  if (process.env.NODE_ENV === "test" && level === "info") return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...meta });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  info: (meta: Meta, message: string) => write("info", meta, message),
  warn: (meta: Meta, message: string) => write("warn", meta, message),
  error: (meta: Meta, message: string) => write("error", meta, message),
};
