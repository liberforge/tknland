/**
 * First three digits of a Peruvian CCI, from the Mettal dashboard catalogue
 * (`bank-codes.peru.list`).
 */
const PERU_BANK_NAMES: Readonly<Record<string, string>> = {
  "002": "Crédito",
  "003": "Interbank",
  "007": "CitiBank",
  "009": "Scotiabank",
  "011": "BBVA",
  "018": "Nación",
  "023": "Comercio",
  "035": "Financiero",
  "038": "BanBif",
  "043": "Crediscotia",
  "049": "MiBanco",
  "051": "Agrobanco",
  "052": "Fondo Mivivienda",
  "053": "GNB",
  "054": "Falabella",
  "055": "Ripley",
  "056": "Santander",
  "058": "Alfin",
  "059": "CAT (Cencosu)",
  "060": "ICBC",
  "061": "JP Morgan",
  "062": "Bank of China",
  "063": "BCI",
  "091": "Compartamos",
  "093": "Qapac (Universal)",
  "094": "Financiera OH!",
  "096": "Efectiva",
  "097": "Mitsui Auto Finance",
  "098": "Proempresa",
  "099": "Confianza",
  "080": "Santander Financiamientos (Sugir)",
  "800": "Lima",
  "801": "Piura",
  "802": "Trujillo",
  "803": "Arequipa",
  "806": "Cusco",
  "807": "Del Santa",
  "808": "Huancayo",
  "809": "Ica",
  "810": "Paita",
  "811": "Maynas",
  "813": "Tacna",
  "849": "Los Andes",
  "850": "Prymera",
  "852": "Incasur",
  "853": "Del Centro",
  "071": "COFIDE",
  "260": "FSD",
  "261": "FSDC",
  "270": "CAVALI",
  "357": "MEF",
  "950": "BITEL",
  "910": "COOPAC Abaco",
  "911": "COOPAC Pacifico",
  "921": "TPP Tarjetas Peruanas Prepago",
  "922": "GMONEY S.A.",
};

/** Bank name for a CCI, or null when the first three digits are not in the catalogue. */
export function peruBankName(account: string): string | null {
  const digits = account.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return PERU_BANK_NAMES[digits.slice(0, 3)] ?? null;
}
