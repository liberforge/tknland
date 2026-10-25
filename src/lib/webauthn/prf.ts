import { base64UrlToBytes, bytesToBase64Url, wipeBytes } from "@/lib/bytes";
import {
  isMockBiometrics,
  mockCredentialId,
  mockPrfOutput,
} from "@/lib/webauthn/mock-biometrics";

export { isMockBiometrics } from "@/lib/webauthn/mock-biometrics";

type PrfExtensionOutputs = {
  enabled?: boolean;
  results?: { first?: ArrayBuffer };
};

function getRpId(): string {
  const host = window.location.hostname;
  // IP hosts are rejected by platform authenticators ("invalid domain").
  // Use http://localhost:5173 for local WebAuthn, not 127.0.0.1.
  if (host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    throw new Error(
      "Abre http://localhost:5173 (no 127.0.0.1): las claves de acceso necesitan un nombre de host.",
    );
  }
  return host;
}

export function getWebAuthnHostHint(): string | null {
  if (isMockBiometrics()) return null;
  const host = window.location.hostname;
  if (host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return "Abre http://localhost:5173 en lugar de 127.0.0.1: la biometría necesita un nombre de host.";
  }
  return null;
}

function webAuthnCreateHint(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return "La clave de acceso se canceló o bloqueó. Abre esta URL en Chrome (no en un navegador integrado), desbloquea el teléfono con biometría o PIN y usa el Administrador de contraseñas de Google.";
  }
  if (name === "NotSupportedError" || name === "SecurityError") {
    return "Este navegador no puede crear aquí una clave de acceso. Hace falta biometría y HTTPS.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "No se pudo crear la clave de acceso";
}

let immediateGetSupported: boolean | null = null;

/** True after `isPrfSupported` when this browser can fail a passkey lookup with no UI. */
export function canImmediateGet(): boolean {
  return immediateGetSupported === true;
}

export async function isPrfSupported(): Promise<boolean> {
  if (isMockBiometrics()) return true;

  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return false;
  }

  try {
    const capsFn = (
      PublicKeyCredential as unknown as {
        getClientCapabilities?: () => Promise<Record<string, boolean>>;
      }
    ).getClientCapabilities;

    if (capsFn) {
      const caps = await capsFn.call(PublicKeyCredential);
      immediateGetSupported = caps.immediateGet === true;
      if (caps["extension:prf"] === true) return true;
      if (caps["extension:prf"] === false) return false;
    }
  } catch {
    // Fall through to platform check.
  }

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export type PasskeyWithPrf = {
  credentialId: Uint8Array;
  prfOutput: Uint8Array;
  /** `PublicKeyCredential.toJSON()` from the create ceremony. */
  registration: Record<string, unknown>;
};

export type PrfAssertion = {
  credentialId: Uint8Array;
  prfOutput: Uint8Array;
  /** `PublicKeyCredential.toJSON()` from the get ceremony. */
  assertion: Record<string, unknown>;
};

export class WebAuthnCancelled extends Error {
  constructor() {
    super("Se canceló la confirmación biométrica.");
    this.name = "WebAuthnCancelled";
  }
}

function isWebAuthnCancel(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "NotAllowedError" || err.name === "AbortError")
  );
}

function standaloneBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function passkeyAccountName(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `tkn.land-${year}-${month}-${day}`;
}

function credentialJson(credential: PublicKeyCredential): Record<string, unknown> {
  const withJson = credential as PublicKeyCredential & {
    toJSON?: () => Record<string, unknown>;
  };
  if (typeof withJson.toJSON !== "function") {
    throw new Error("Este navegador no puede enviar la clave de acceso.");
  }
  return withJson.toJSON() as unknown as Record<string, unknown>;
}

async function createPlatformCredential(
  prfSalt: Uint8Array,
  challenge: Uint8Array,
): Promise<PublicKeyCredential> {
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const accountName = passkeyAccountName();
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: standaloneBuffer(challenge),
    rp: { name: "tkn.land", id: getRpId() },
    user: {
      id: userId,
      name: accountName,
      displayName: accountName,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    timeout: 90_000,
    attestation: "none",
    extensions: {
      prf: { eval: { first: prfSalt } },
    } as AuthenticationExtensionsClientInputs,
  };
  (
    publicKey as PublicKeyCredentialCreationOptions & { hints?: string[] }
  ).hints = ["client-device"];
  const credential = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new WebAuthnCancelled();
  }
  return credential;
}

export async function createPasskeyWithPrf(
  prfSalt: Uint8Array,
  challenge: Uint8Array,
): Promise<PasskeyWithPrf> {
  if (isMockBiometrics()) {
    return {
      credentialId: mockCredentialId(),
      prfOutput: await mockPrfOutput(prfSalt),
      registration: { mock: true },
    };
  }

  let credential: PublicKeyCredential;
  try {
    credential = await createPlatformCredential(prfSalt, challenge);
  } catch (err) {
    if (err instanceof WebAuthnCancelled || isWebAuthnCancel(err)) {
      throw new WebAuthnCancelled();
    }
    throw new Error(webAuthnCreateHint(err));
  }

  const ext = credential.getClientExtensionResults() as {
    prf?: PrfExtensionOutputs;
  };
  if (ext.prf?.enabled === false) {
    throw new Error("Este dispositivo no admite claves de acceso con PRF");
  }

  const credentialId = new Uint8Array(credential.rawId);
  const registration = credentialJson(credential);
  const fromCreate = ext.prf?.results?.first;
  if (fromCreate) {
    return {
      credentialId,
      prfOutput: new Uint8Array(fromCreate),
      registration,
    };
  }

  // Android / some browsers only return PRF output on assert, not create.
  const asserted = await assertPasskeyWithPrf({ credentialId, prfSalt });
  return {
    credentialId,
    prfOutput: asserted.prfOutput,
    registration,
  };
}

export async function assertPasskeyWithPrf(opts: {
  credentialId?: Uint8Array;
  prfSalt: Uint8Array;
  challenge?: Uint8Array;
  /** Fail at once, with no sheet, when this device has no passkey. */
  immediate?: boolean;
}): Promise<PrfAssertion> {
  if (isMockBiometrics()) {
    return {
      credentialId: opts.credentialId ?? mockCredentialId(),
      prfOutput: await mockPrfOutput(opts.prfSalt),
      assertion: { mock: true },
    };
  }

  const challenge = opts.challenge ?? crypto.getRandomValues(new Uint8Array(32));
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: standaloneBuffer(challenge),
    rpId: getRpId(),
    userVerification: "required",
    timeout: 90_000,
    extensions: {
      prf: {
        eval: { first: opts.prfSalt },
        ...(opts.credentialId
          ? {
              evalByCredential: {
                [bytesToBase64Url(opts.credentialId)]: { first: opts.prfSalt },
              },
            }
          : {}),
      },
    } as AuthenticationExtensionsClientInputs,
  };
  if (opts.credentialId) {
    publicKey.allowCredentials = [
      {
        type: "public-key",
        id: standaloneBuffer(opts.credentialId),
        transports: ["internal"],
      },
    ];
  } else {
    (
      publicKey as PublicKeyCredentialRequestOptions & { hints?: string[] }
    ).hints = ["client-device"];
  }

  const request: CredentialRequestOptions = { publicKey };
  if (opts.immediate && !opts.credentialId) {
    (request as CredentialRequestOptions & { uiMode?: string }).uiMode =
      "immediate";
  }

  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get(request)) as PublicKeyCredential | null;
  } catch (err) {
    if (isWebAuthnCancel(err)) throw new WebAuthnCancelled();
    throw err;
  }
  if (!assertion) throw new WebAuthnCancelled();

  const ext = assertion.getClientExtensionResults() as {
    prf?: PrfExtensionOutputs;
  };
  const prfFirst = ext.prf?.results?.first;
  if (!prfFirst) {
    throw new Error("Falta el resultado PRF de la clave de acceso");
  }

  return {
    credentialId: new Uint8Array(assertion.rawId),
    prfOutput: new Uint8Array(prfFirst),
    assertion: credentialJson(assertion),
  };
}

export function parseCredentialId(stored: string): Uint8Array {
  return base64UrlToBytes(stored);
}

export function formatCredentialId(id: Uint8Array): string {
  return bytesToBase64Url(id);
}

export function wipePrfOutput(prf: Uint8Array): void {
  wipeBytes(prf);
}
