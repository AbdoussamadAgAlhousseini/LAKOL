/* Génère les icônes de l'application (PWA) à partir d'un SVG : pnpm icons */
import sharp from "sharp";

const svg = (padding) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${padding ? 0 : 96}" fill="#0F766E"/>
  <g transform="translate(${padding} ${padding}) scale(${(512 - 2 * padding) / 512})">
    <path d="M168 120h56v216h128v56H168z" fill="#ffffff"/>
    <circle cx="352" cy="152" r="32" fill="#F59E0B"/>
  </g>
</svg>`;

const targets = [
  ["public/icons/icon-192.png", 192, 0],
  ["public/icons/icon-512.png", 512, 0],
  // « maskable » : marge de sécurité, le système découpe l'icône en cercle ou en carré arrondi.
  ["public/icons/maskable-512.png", 512, 64],
  ["public/icons/apple-touch-icon.png", 180, 0],
];
for (const [file, size, padding] of targets) {
  await sharp(Buffer.from(svg(padding)))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(file);
}
