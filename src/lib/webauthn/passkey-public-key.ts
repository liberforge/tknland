import { base64UrlToBytes, bytesToBase64Url } from "@/lib/bytes";

/**
 * COSE public key from a WebAuthn registration, base64url.
 * This is the same encoding Upstash stores. It is not a secret.
 * Returns null when the registration has no attestation (the local mock).
 */
export function passkeyPublicKeyFromRegistration(
  registration: Record<string, unknown>,
): string | null {
  const response = registration.response;
  if (!response || typeof response !== "object") return null;
  const attestation = (response as Record<string, unknown>).attestationObject;
  if (typeof attestation !== "string" || !attestation) return null;
  const cose = cosePublicKeyFromAttestation(base64UrlToBytes(attestation));
  if (!cose) return null;
  return bytesToBase64Url(cose);
}

function cosePublicKeyFromAttestation(attestation: Uint8Array): Uint8Array | null {
  const authData = attestationAuthData(attestation);
  if (!authData || authData.length < 55) return null;
  const flags = authData[32];
  const attested = (flags & 0x40) !== 0;
  if (!attested) return null;
  const credIdLen = (authData[53] << 8) | authData[54];
  const keyAt = 55 + credIdLen;
  if (credIdLen < 1 || keyAt >= authData.length) return null;
  const keyEnd = cborItemEnd(authData, keyAt);
  if (keyEnd <= keyAt) return null;
  return authData.slice(keyAt, keyEnd);
}

function attestationAuthData(attestation: Uint8Array): Uint8Array | null {
  if ((attestation[0] >> 5) !== 5) return null;
  const header = cborHeader(attestation, 0);
  let offset = header.next;
  for (let i = 0; i < header.length; i++) {
    const keyEnd = cborItemEnd(attestation, offset);
    const key = attestation.slice(offset, keyEnd);
    offset = keyEnd;
    const valueEnd = cborItemEnd(attestation, offset);
    if (isText(key, "authData")) {
      return readByteString(attestation, offset);
    }
    offset = valueEnd;
  }
  return null;
}

function isText(item: Uint8Array, text: string): boolean {
  if ((item[0] >> 5) !== 3) return false;
  const header = cborHeader(item, 0);
  const bytes = item.slice(header.next, header.next + header.length);
  return new TextDecoder().decode(bytes) === text;
}

function readByteString(bytes: Uint8Array, offset: number): Uint8Array | null {
  if ((bytes[offset] >> 5) !== 2) return null;
  const header = cborHeader(bytes, offset);
  return bytes.slice(header.next, header.next + header.length);
}

function cborItemEnd(bytes: Uint8Array, offset: number): number {
  const header = cborHeader(bytes, offset);
  const major = bytes[offset] >> 5;
  if (major === 0 || major === 1 || major === 7) return header.next;
  if (major === 2 || major === 3) return header.next + header.length;
  if (major === 6) return cborItemEnd(bytes, header.next);
  let cursor = header.next;
  const pairs = major === 5 ? header.length * 2 : header.length;
  if (major !== 4 && major !== 5) {
    throw new Error("El registro de la clave no es válido.");
  }
  for (let i = 0; i < pairs; i++) cursor = cborItemEnd(bytes, cursor);
  return cursor;
}

function cborHeader(
  bytes: Uint8Array,
  offset: number,
): { length: number; next: number } {
  if (offset >= bytes.length) {
    throw new Error("El registro de la clave no es válido.");
  }
  const ai = bytes[offset] & 0x1f;
  if (ai < 24) return { length: ai, next: offset + 1 };
  if (ai === 24) return { length: bytes[offset + 1], next: offset + 2 };
  if (ai === 25) {
    return {
      length: (bytes[offset + 1] << 8) | bytes[offset + 2],
      next: offset + 3,
    };
  }
  if (ai === 26) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4);
    return { length: view.getUint32(0), next: offset + 5 };
  }
  throw new Error("El registro de la clave no es válido.");
}
