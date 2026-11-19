/**
 * First three digits of a Peruvian CCI. Names are Mettal's immediate-transfer
 * catalogue (`PE_IMMEDIATE_CCE_BANKS`).
 */
const PERU_BANK_NAMES: Readonly<Record<string, string>> = {
  "002": "Banco de Crédito del Perú",
  "003": "Interbank",
  "007": "CITIBANK",
  "009": "Scotiabank Perú S.A.A.",
  "011": "BBVA Continental",
  "018": "Banco de la Nación",
  "023": "Banco de Comercio",
  "035": "Banco Pichincha",
  "038": "BANBIF",
  "043": "Santander Consumer Bank",
  "049": "MiBanco",
  "053": "Banco GNB",
  "054": "Banco Falabella",
  "055": "Banco Ripley",
  "056": "Banco Santander",
  "058": "Alfin Banco",
  "091": "Compartamos Banco S.A.",
  "094": "SIP",
  "096": "Efectibank",
  "099": "Financiera Confianza",
  "776": "PREXPE (GMONEY S.A.)",
  "800": "Caja Metropolitana",
  "801": "CMAC Piura",
  "802": "CMAC Trujillo",
  "803": "CMAC Arequipa",
  "806": "CMAC Cusco",
  "808": "CMAC Huancayo",
  "809": "CMAC ICA",
  "811": "CMAC MAYNAS",
  "813": "CMAC TACNA",
  "849": "Los Andes",
  "921": "EEDE Tarjetas Peruanas (LIGO)",
  "922": "Dale (Lemon)",
};

/** Bank name for a CCI, or null when the first three digits are not in the catalogue. */
export function peruBankName(account: string): string | null {
  const digits = account.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return PERU_BANK_NAMES[digits.slice(0, 3)] ?? null;
}
