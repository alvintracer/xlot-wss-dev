import { createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

function decodeMaterial(value, expectedBytes, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is missing.`);

  const utf8 = Buffer.from(normalized, "utf8");
  if (utf8.length === expectedBytes) return utf8;

  if (
    normalized.length === expectedBytes * 2 &&
    /^[0-9a-f]+$/i.test(normalized)
  ) {
    return Buffer.from(normalized, "hex");
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    const decoded = Buffer.from(normalized, "base64");
    if (
      decoded.length === expectedBytes &&
      timingSafeEqual(
        Buffer.from(decoded.toString("base64").replace(/=+$/, "")),
        Buffer.from(normalized.replace(/=+$/, "")),
      )
    ) {
      return decoded;
    }
  }

  throw new Error(`${label} must decode to exactly ${expectedBytes} bytes.`);
}

export function createAes256CbcCodec({ key, iv }) {
  const keyBytes = decodeMaterial(key, 32, "TRANSIGHT_ENCRYPTION_KEY");
  const ivBytes = decodeMaterial(iv, 16, "TRANSIGHT_ENCRYPTION_IV");

  return Object.freeze({
    encryptUtf8(plaintext) {
      const cipher = createCipheriv("aes-256-cbc", keyBytes, ivBytes);
      cipher.setAutoPadding(true);
      return Buffer.concat([
        cipher.update(String(plaintext), "utf8"),
        cipher.final(),
      ]).toString("base64");
    },
    decryptUtf8(ciphertext) {
      const encoded = String(ciphertext ?? "").trim();
      if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error("Encrypted payload is not valid Base64.");
      }
      const decipher = createDecipheriv("aes-256-cbc", keyBytes, ivBytes);
      decipher.setAutoPadding(true);
      return Buffer.concat([
        decipher.update(Buffer.from(encoded, "base64")),
        decipher.final(),
      ]).toString("utf8");
    },
  });
}
