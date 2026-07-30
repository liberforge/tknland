import {
  bytesToUtf8,
  randomBytes,
  utf8ToBytes,
  wipeBytes,
} from "@/lib/bytes";

const HKDF_INFO = utf8ToBytes("tkn.land/vault-aes-v1");

export async function aesKeyFromPrf(
  prfOutput: Uint8Array,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: HKDF_INFO,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export type EncryptedBlob = {
  iv: Uint8Array;
  ciphertext: Uint8Array;
};

export async function encryptUtf8(
  plaintext: string,
  key: CryptoKey,
): Promise<EncryptedBlob> {
  const iv = randomBytes(12);
  const data = utf8ToBytes(plaintext);
  try {
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data),
    );
    return { iv, ciphertext };
  } finally {
    wipeBytes(data);
  }
}

export async function decryptUtf8(
  blob: EncryptedBlob,
  key: CryptoKey,
): Promise<string> {
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: blob.iv },
      key,
      blob.ciphertext,
    ),
  );
  try {
    return bytesToUtf8(plain);
  } finally {
    wipeBytes(plain);
  }
}
