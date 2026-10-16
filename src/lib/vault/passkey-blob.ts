/**
 * Compact secrets stored in the passkey largeBlob (1 KB).
 * IndexedDB can be wiped by the browser. The blob lives in the passkey, so
 * Android and iOS read the same seed and Mettal key after that wipe.
 */
const VERSION = 1;
const FLAG_METTAL = 1;
const FLAG_ADDRESS = 2;
const MAX_BLOB_BYTES = 1024;

export type PasskeyBlob = {
  vaultId: string;
  prfSalt: Uint8Array;
  seedIv: Uint8Array;
  seedCiphertext: Uint8Array;
  mettalIv?: Uint8Array;
  mettalCiphertext?: Uint8Array;
  /** Primary account, 20-byte EVM address. Public; lets a restore show the balance. */
  address?: Uint8Array;
};

function requireLength(label: string, bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) {
    throw new Error(`${label} no tiene el tamaño esperado.`);
  }
}

export function encodePasskeyBlob(blob: PasskeyBlob): Uint8Array {
  const vaultIdBytes = new TextEncoder().encode(blob.vaultId);
  if (vaultIdBytes.length < 1 || vaultIdBytes.length > 64) {
    throw new Error("El identificador de la bóveda no entra en el llavero.");
  }
  requireLength("La sal", blob.prfSalt, 32);
  requireLength("El IV de la frase", blob.seedIv, 12);
  if (blob.seedCiphertext.length < 1 || blob.seedCiphertext.length > 600) {
    throw new Error("La frase cifrada no entra en el llavero.");
  }

  const hasMettal = blob.mettalIv != null && blob.mettalCiphertext != null;
  if (hasMettal) {
    requireLength("El IV de Mettal", blob.mettalIv!, 12);
    if (blob.mettalCiphertext!.length < 1 || blob.mettalCiphertext!.length > 700) {
      throw new Error("La API key cifrada no entra en el llavero.");
    }
  }
  const hasAddress = blob.address != null;
  if (hasAddress) requireLength("La dirección", blob.address!, 20);

  const mettalBytes = hasMettal ? 12 + 2 + blob.mettalCiphertext!.length : 0;
  const addressBytes = hasAddress ? 20 : 0;
  const total =
    1 +
    1 +
    1 +
    vaultIdBytes.length +
    32 +
    12 +
    2 +
    blob.seedCiphertext.length +
    mettalBytes +
    addressBytes;
  if (total > MAX_BLOB_BYTES) {
    throw new Error("Las credenciales no entran en el llavero de este dispositivo.");
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  let flags = 0;
  if (hasMettal) flags |= FLAG_METTAL;
  if (hasAddress) flags |= FLAG_ADDRESS;
  out[offset++] = VERSION;
  out[offset++] = flags;
  out[offset++] = vaultIdBytes.length;
  out.set(vaultIdBytes, offset);
  offset += vaultIdBytes.length;
  out.set(blob.prfSalt, offset);
  offset += 32;
  out.set(blob.seedIv, offset);
  offset += 12;
  view.setUint16(offset, blob.seedCiphertext.length, false);
  offset += 2;
  out.set(blob.seedCiphertext, offset);
  offset += blob.seedCiphertext.length;
  if (hasMettal) {
    out.set(blob.mettalIv!, offset);
    offset += 12;
    view.setUint16(offset, blob.mettalCiphertext!.length, false);
    offset += 2;
    out.set(blob.mettalCiphertext!, offset);
    offset += blob.mettalCiphertext!.length;
  }
  if (hasAddress) out.set(blob.address!, offset);
  return out;
}

function take(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  if (offset + length > bytes.length) {
    throw new Error("El llavero está incompleto.");
  }
  return bytes.slice(offset, offset + length);
}

export function decodePasskeyBlob(bytes: Uint8Array): PasskeyBlob {
  if (bytes.length < 1 + 1 + 1 + 1 + 32 + 12 + 2) {
    throw new Error("El llavero no tiene una billetera válida.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const version = bytes[offset++];
  if (version !== VERSION) {
    throw new Error("El llavero tiene un formato desconocido.");
  }
  const flags = bytes[offset++];
  const idLength = bytes[offset++];
  const vaultIdBytes = take(bytes, offset, idLength);
  offset += idLength;
  const vaultId = new TextDecoder().decode(vaultIdBytes);
  if (!vaultId) {
    throw new Error("El llavero no tiene una billetera válida.");
  }
  const prfSalt = take(bytes, offset, 32);
  offset += 32;
  const seedIv = take(bytes, offset, 12);
  offset += 12;
  if (offset + 2 > bytes.length) {
    throw new Error("El llavero está incompleto.");
  }
  const seedLength = view.getUint16(offset, false);
  offset += 2;
  const seedCiphertext = take(bytes, offset, seedLength);
  offset += seedLength;

  const decoded: PasskeyBlob = {
    vaultId,
    prfSalt,
    seedIv,
    seedCiphertext,
  };

  if ((flags & FLAG_METTAL) !== 0) {
    const mettalIv = take(bytes, offset, 12);
    offset += 12;
    if (offset + 2 > bytes.length) {
      throw new Error("El llavero está incompleto.");
    }
    const mettalLength = view.getUint16(offset, false);
    offset += 2;
    decoded.mettalIv = mettalIv;
    decoded.mettalCiphertext = take(bytes, offset, mettalLength);
    offset += mettalLength;
  }
  if ((flags & FLAG_ADDRESS) !== 0) {
    decoded.address = take(bytes, offset, 20);
  }

  return decoded;
}
