import "server-only";
import sharp from "sharp";

const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Compresse une image envoyée (photo d'élève, logo, pièce jointe) : orientation
 * corrigée, 1600 px au plus, format WebP. Une photo de téléphone de 3 Mo
 * descend à ~200 Ko, ce qui compte en 3G. Les autres fichiers sont inchangés.
 */
export async function compressUpload(body: Buffer, mimeType: string) {
  if (!COMPRESSIBLE.has(mimeType)) return { body, mimeType };
  try {
    const out = await sharp(body)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return out.length < body.length ? { body: out, mimeType: "image/webp" } : { body, mimeType };
  } catch {
    return { body, mimeType }; // image illisible : stockée telle quelle (le type a déjà été contrôlé)
  }
}
