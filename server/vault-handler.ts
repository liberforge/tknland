import { Redis } from "@upstash/redis";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { base64UrlToBytes, bytesToBase64Url, randomBytes } from "../src/lib/bytes.ts";

const CHALLENGE_TTL_SECONDS = 120;
const MAX_BLOB_CHARS = 12_000;

type StoredVault = {
  publicKey: string;
  counter: number;
  blob: string;
};

type VaultResult = {
  status: number;
  body: Record<string, unknown>;
};

export class VaultHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "VaultHttpError";
    this.status = status;
  }
}

function writeRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new VaultHttpError(500, "El almacén no está configurado.");
  }
  return new Redis({ url, token });
}

function readRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token =
    process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new VaultHttpError(500, "El almacén no está configurado.");
  }
  return new Redis({ url, token });
}

function vaultKey(credentialId: string): string {
  return `vault:${credentialId}`;
}

function challengeKey(challenge: string): string {
  return `chal:${challenge}`;
}

function requestOrigin(origin: string | null): { origin: string; rpId: string } {
  if (!origin) throw new VaultHttpError(400, "Falta el origen de la solicitud.");
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new VaultHttpError(400, "El origen no es válido.");
  }
  const localhost = url.hostname === "localhost";
  const allowed =
    url.protocol === "https:" || (localhost && url.protocol === "http:");
  if (!allowed || !url.hostname) {
    throw new VaultHttpError(400, "El origen no es válido.");
  }
  return { origin: url.origin, rpId: url.hostname };
}

function credentialIdOf(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,512}$/.test(value)) {
    throw new VaultHttpError(400, "La clave de acceso no es válida.");
  }
  return value;
}

function blobOf(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,12000}$/.test(value)) {
    throw new VaultHttpError(400, "El contenido cifrado no es válido.");
  }
  if (value.length > MAX_BLOB_CHARS) {
    throw new VaultHttpError(400, "El contenido cifrado no es válido.");
  }
  const bytes = Math.floor((value.length * 3) / 4);
  if (bytes < 13 || bytes > 8192) {
    throw new VaultHttpError(400, "El contenido cifrado no es válido.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function asRegistration(value: unknown): RegistrationResponseJSON {
  if (!isRecord(value) || !isRecord(value.response)) {
    throw new VaultHttpError(400, "El registro de la clave no es válido.");
  }
  if (
    value.type !== "public-key" ||
    typeof value.id !== "string" ||
    typeof value.response.clientDataJSON !== "string" ||
    typeof value.response.attestationObject !== "string"
  ) {
    throw new VaultHttpError(400, "El registro de la clave no es válido.");
  }
  return value as unknown as RegistrationResponseJSON;
}

function asAssertion(value: unknown): AuthenticationResponseJSON {
  if (!isRecord(value) || !isRecord(value.response)) {
    throw new VaultHttpError(400, "La confirmación de la clave no es válida.");
  }
  if (
    value.type !== "public-key" ||
    typeof value.id !== "string" ||
    typeof value.response.clientDataJSON !== "string" ||
    typeof value.response.authenticatorData !== "string" ||
    typeof value.response.signature !== "string"
  ) {
    throw new VaultHttpError(400, "La confirmación de la clave no es válida.");
  }
  return value as unknown as AuthenticationResponseJSON;
}

async function issueChallenge(origin: string): Promise<string> {
  const challenge = bytesToBase64Url(randomBytes(32));
  const saved = await writeRedis().set(challengeKey(challenge), origin, {
    ex: CHALLENGE_TTL_SECONDS,
    nx: true,
  });
  if (saved !== "OK") {
    throw new VaultHttpError(500, "No se pudo preparar la confirmación.");
  }
  return challenge;
}

async function consumeChallenge(
  challenge: string,
  origin: string,
): Promise<boolean> {
  const stored = await writeRedis().getdel<string>(challengeKey(challenge));
  return stored === origin;
}

async function readVault(credentialId: string): Promise<VaultResult> {
  const row = await readRedis().get<StoredVault>(vaultKey(credentialIdOf(credentialId)));
  if (!row?.blob || !row.publicKey) {
    return { status: 404, body: { error: "No hay una billetera para esa clave." } };
  }
  return { status: 200, body: { blob: row.blob } };
}

async function createVault(
  origin: string,
  rpId: string,
  registration: RegistrationResponseJSON,
  blob: string,
): Promise<VaultResult> {
  let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verified = await verifyRegistrationResponse({
      response: registration,
      expectedChallenge: (challenge) => consumeChallenge(challenge, origin),
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: true,
    });
  } catch (err) {
    console.error("vault create verify", err);
    throw new VaultHttpError(401, "La clave de acceso no autorizó este guardado.");
  }
  if (!verified.verified) {
    throw new VaultHttpError(401, "La clave de acceso no autorizó este guardado.");
  }

  const credential = verified.registrationInfo.credential;
  const id = credentialIdOf(credential.id);
  const key = vaultKey(id);
  const redis = writeRedis();
  const existing = await redis.get<StoredVault>(key);
  if (existing?.publicKey) {
    throw new VaultHttpError(409, "Esa clave ya tiene una billetera.");
  }

  const row: StoredVault = {
    publicKey: bytesToBase64Url(new Uint8Array(credential.publicKey)),
    counter: credential.counter,
    blob,
  };
  const created = await redis.set(key, row, { nx: true });
  if (created !== "OK") {
    throw new VaultHttpError(409, "Esa clave ya tiene una billetera.");
  }
  return { status: 201, body: { ok: true } };
}

async function updateVault(
  origin: string,
  rpId: string,
  assertion: AuthenticationResponseJSON,
  blob: string,
): Promise<VaultResult> {
  const id = credentialIdOf(assertion.id);
  const redis = writeRedis();
  const row = await redis.get<StoredVault>(vaultKey(id));
  if (!row?.publicKey || !row.blob) {
    throw new VaultHttpError(404, "No hay una billetera para esa clave.");
  }

  let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verified = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: (challenge) => consumeChallenge(challenge, origin),
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: true,
      credential: {
        id,
        publicKey: new Uint8Array(base64UrlToBytes(row.publicKey)),
        counter: row.counter,
      },
    });
  } catch (err) {
    console.error("vault update verify", err);
    throw new VaultHttpError(401, "La clave de acceso no autorizó este guardado.");
  }
  if (!verified.verified || verified.authenticationInfo.credentialID !== id) {
    throw new VaultHttpError(401, "La clave de acceso no autorizó este guardado.");
  }

  const next: StoredVault = {
    publicKey: row.publicKey,
    counter: verified.authenticationInfo.newCounter,
    blob,
  };
  await redis.set(vaultKey(id), next);
  return { status: 200, body: { ok: true } };
}

export async function handleVault(input: {
  method: string;
  url: URL;
  origin: string | null;
  body: unknown;
}): Promise<VaultResult> {
  try {
    if (input.method === "GET") {
      return await readVault(input.url.searchParams.get("credentialId") ?? "");
    }
    if (input.method !== "POST") {
      return { status: 405, body: { error: "Método no permitido." } };
    }

    const { origin, rpId } = requestOrigin(input.origin);
    const body = isRecord(input.body) ? input.body : {};
    if (body.op === "challenge") {
      return { status: 200, body: { challenge: await issueChallenge(origin) } };
    }
    if (body.op === "create") {
      return await createVault(
        origin,
        rpId,
        asRegistration(body.registration),
        blobOf(body.blob),
      );
    }
    if (body.op === "update") {
      return await updateVault(
        origin,
        rpId,
        asAssertion(body.assertion),
        blobOf(body.blob),
      );
    }
    return { status: 400, body: { error: "La solicitud no es válida." } };
  } catch (err) {
    if (err instanceof VaultHttpError) {
      return { status: err.status, body: { error: err.message } };
    }
    console.error("vault", err);
    return { status: 500, body: { error: "No se pudo guardar la billetera." } };
  }
}
