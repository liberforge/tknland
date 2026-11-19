/**
 * Ported from Ramp staging Alfin deposit simulation (no Ramp runtime dependency).
 * Posts a fabricated income webhook to Mettal's staging integration gateway.
 * Keep in sync if Alfin webhook shape changes.
 */

const DEFAULT_WEBHOOK_URL = "https://intgr.stg.mettal.io/alfin/webhook";

function deriveTrace(seed) {
  let value = 0;
  for (const char of seed) {
    value = (value * 31 + char.charCodeAt(0)) % 1_000_000_000;
  }
  return value || 1;
}

/**
 * @param {{ amountMajor: number, bankAccount: string, currency?: string, label?: string }} input
 */
export function buildAlfinSimulatedDepositPayload(input) {
  const bankAccount = String(input.bankAccount ?? "").trim();
  if (!bankAccount) throw new Error("bankAccount is required");

  const amount = Number(Number(input.amountMajor).toFixed(2));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid deposit amount: ${input.amountMajor}`);
  }

  const now = new Date();
  const timestamp = now.getTime();
  const date = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("/");
  const time = [
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join(":");

  const label = input.label ?? "tknland-journey-battery";

  return {
    CuentaBeneficiario: 101713,
    NombreBeneficiario: "MAXIMO PAY S.A.C.",
    UltimaTrnRecibida: amount,
    ImporteRecaudado: amount,
    CantidadTrnRecibida: 1,
    Fecha: date,
    Hora: time,
    NombreOriginante: label,
    CCI: bankAccount,
    CCIV: bankAccount,
    CodigoPagoCCIV: bankAccount,
    Referencia: `${label}-${bankAccount.slice(-6)}-${timestamp}`,
    Trace: deriveTrace(`${label}:${bankAccount}:${timestamp}`),
    CodigoTransaccion: "320",
    TipoDocOri: "RUC",
    NroDocOri: "20605115234",
    Codigo: `alfin-${label}-${timestamp}`,
    CCIOrigen: "80607232100002710754",
    BancoOrigen: "CMAC Cusco",
    Moneda: (input.currency ?? "PEN").trim().toUpperCase(),
  };
}

/**
 * @param {{ amountMajor: number, bankAccount: string, currency?: string, webhookUrl?: string, label?: string }} input
 */
export async function simulateFiatDeposit(input) {
  const webhookUrl = (input.webhookUrl ?? DEFAULT_WEBHOOK_URL).trim();
  const payload = buildAlfinSimulatedDepositPayload(input);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(
      `Alfin simulate deposit failed HTTP ${response.status}${body ? `: ${body}` : ""}`,
    );
  }
  return { webhookUrl, payload, responseBody: body || null };
}
