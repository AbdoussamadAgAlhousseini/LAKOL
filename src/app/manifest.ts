import type { MetadataRoute } from "next";

// Application installable (PWA) : icône sur l'écran d'accueil, plein écran.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LAKOL — gestion scolaire",
    short_name: "LAKOL",
    description: "Devoirs, notes, absences, paiements et messages de l'école.",
    start_url: "/fr/spaces",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0f766e",
    lang: "fr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
