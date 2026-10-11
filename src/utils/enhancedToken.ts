
















import { ed25519, ed25519ph } from "@noble/curves/ed25519.js";

const ENHANCED_TOKEN_PREFIX = "gtfy";

export const ENHANCED_TOKEN_MAX_TIMESTAMP_DIFF_SECONDS = 15 * 60;

const SEED_SIZE = 32;
const PUBLIC_KEY_SIZE = 32;
const SIGNATURE_SIZE = 64;

const BASE64URL_CHARS = /^[A-Za-z0-9\-_]*$/;


export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}





export function base64UrlDecode(input: string): Uint8Array | null {
  if (!BASE64URL_CHARS.test(input) || input.length % 4 === 1) return null;
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}





export function generateEnhancedToken(kind: "app" | "client"): { publicForm: string; privateForm: string } {
  const ident = (kind === "app" ? "a" : "c").replace(/\./g, "_");
  const seed = crypto.getRandomValues(new Uint8Array(SEED_SIZE));
  const publicKey = ed25519.getPublicKey(seed);
  return {
    publicForm: `${ENHANCED_TOKEN_PREFIX}${ident}.${base64UrlEncode(publicKey)}`,
    privateForm: `${ENHANCED_TOKEN_PREFIX}${ident}.${base64UrlEncode(seed)}`
  };
}





export async function resolveTokenForLookup(token: string): Promise<string | null> {
  if (!token.startsWith(ENHANCED_TOKEN_PREFIX)) {
    return token;
  }

  const fields = token.slice(ENHANCED_TOKEN_PREFIX.length).split(".");
  if (fields.length !== 2 && fields.length !== 4) return null;
  const [ident, keyB64] = fields;
  const keyBytes = base64UrlDecode(keyB64);
  if (keyBytes === null) return null;

  if (fields.length === 2) {

    if (keyBytes.length !== SEED_SIZE) return null;
    const publicKey = ed25519.getPublicKey(keyBytes);
    return `${ENHANCED_TOKEN_PREFIX}${ident}.${base64UrlEncode(publicKey)}`;
  }


  if (keyBytes.length !== PUBLIC_KEY_SIZE) return null;
  const iatString = fields[2];
  if (!/^[+-]?\d+$/.test(iatString)) return null;
  const iat = Number(iatString);

  if (!Number.isSafeInteger(iat)) return null;
  const signature = base64UrlDecode(fields[3]);
  if (signature === null || signature.length !== SIGNATURE_SIZE) return null;


  const message = new TextEncoder().encode(`iat=${iat}`);
  let valid = false;
  try {
    valid = ed25519ph.verify(signature, message, keyBytes);
  } catch {
    return null;
  }
  if (!valid) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - iat) > ENHANCED_TOKEN_MAX_TIMESTAMP_DIFF_SECONDS) return null;

  return `${ENHANCED_TOKEN_PREFIX}${ident}.${base64UrlEncode(keyBytes)}`;
}
