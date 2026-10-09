import { defineRouting } from "next-intl/routing";

// Ajouter une langue (ex. "bm" pour le bambara) : l'ajouter ici et créer
// src/messages/<code>.json.
export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
});

export type Locale = (typeof routing.locales)[number];
