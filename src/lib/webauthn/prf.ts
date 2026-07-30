import { base64UrlToBytes, bytesToBase64Url, wipeBytes } from "@/lib/bytes";

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
      "Open http://localhost:5173 (not 127.0.0.1) — passkeys need a real hostname.",
    );
  }
  return host;
}

export function getWebAuthnHostHint(): string | null {
  const host = window.location.hostname;
  if (host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return "Open http://localhost:5173 instead of 127.0.0.1 — biometrics need a hostname.";
  }
  return null;
}

function webAuthnCreateHint(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return "Passkey was cancelled or blocked. Open this URL in Chrome (not an in-app browser), unlock the phone with biometrics/PIN, and use Google Password Manager as the passkey provider.";
  }
  if (name === "NotSupportedError" || name === "SecurityError") {
    return "This browser cannot create a device passkey here. Use Chrome on Android 14+ (or Safari on iOS 18+) over HTTPS.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "Passkey creation failed";
}

export async function isPrfSupported(): Promise<boolean> {
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
};

export async function createPasskeyWithPrf(
  prfSalt: Uint8Array,
): Promise<PasskeyWithPrf> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "tkn.land", id: getRpId() },
        user: {
          id: userId,
          name: "tkn.land",
          displayName: "tkn.land",
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
        // Request PRF support only; some platforms refuse eval-on-create.
        // Derive bytes via an immediate get() below.
        extensions: {
          prf: {},
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw new Error(webAuthnCreateHint(err));
  }

  if (!credential) {
    throw new Error("Passkey creation was cancelled");
  }

  const ext = credential.getClientExtensionResults() as {
    prf?: PrfExtensionOutputs;
  };
  if (ext.prf?.enabled === false) {
    throw new Error("This device does not support passkey PRF");
  }

  const credentialId = new Uint8Array(credential.rawId);
  const fromCreate = ext.prf?.results?.first;
  if (fromCreate) {
    return {
      credentialId,
      prfOutput: new Uint8Array(fromCreate),
    };
  }

  // Android / some browsers only return PRF output on assert, not create.
  const prfOutput = await assertPasskeyWithPrf({ credentialId, prfSalt });
  return { credentialId, prfOutput };
}

export async function assertPasskeyWithPrf(opts: {
  credentialId: Uint8Array;
  prfSalt: Uint8Array;
}): Promise<Uint8Array> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credentialIdB64 = bytesToBase64Url(opts.credentialId);

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: getRpId(),
      allowCredentials: [
        {
          type: "public-key",
          id: opts.credentialId,
          transports: ["internal"],
        },
      ],
      userVerification: "required",
      timeout: 90_000,
      extensions: {
        prf: {
          eval: { first: opts.prfSalt },
          evalByCredential: {
            [credentialIdB64]: { first: opts.prfSalt },
          },
        },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error("Biometric unlock was cancelled");
  }

  const ext = assertion.getClientExtensionResults() as {
    prf?: PrfExtensionOutputs;
  };
  const prfFirst = ext.prf?.results?.first;
  if (!prfFirst) {
    throw new Error("PRF result missing from passkey assertion");
  }

  return new Uint8Array(prfFirst);
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
