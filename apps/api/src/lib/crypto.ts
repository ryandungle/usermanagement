/**
 * AES-256-GCM encryption for secrets at rest (connection strings). The key is
 * derived from BETTER_AUTH_SECRET with HKDF so rotating that secret rotates
 * this key too. Works on Workers and Node via WebCrypto.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("usermanagement:office-connector"), info: enc.encode("aes-gcm-256") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const b64 = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
  decode: (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0)),
};

export async function encryptSecret(secret: string, plaintext: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));
  return `v1.${b64.encode(iv)}.${b64.encode(ct)}`;
}

export async function decryptSecret(secret: string, payload: string): Promise<string> {
  const [version, ivB64, ctB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !ctB64) throw new Error("Unrecognised secret payload");
  const key = await deriveKey(secret);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.decode(ivB64) }, key, b64.decode(ctB64));
  return dec.decode(pt);
}
