import { createHash, randomBytes } from "node:crypto";

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateNumericCode(length = 6): string {
  const max = 10 ** length;
  const n = randomBytes(4).readUInt32BE(0) % max;
  return n.toString().padStart(length, "0");
}
