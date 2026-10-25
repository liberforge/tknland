/**
 * Input to WebAuthn PRF for every vault on this origin.
 * It is not a secret: the browser still needs the passkey and biometrics.
 * A fixed value lets an empty IndexedDB ask for the same key.
 */
export const VAULT_PRF_SALT = Uint8Array.from([
  49, 77, 4, 141, 51, 30, 154, 113, 181, 88, 102, 129, 161, 183, 218, 232, 230,
  110, 52, 52, 94, 169, 24, 43, 156, 234, 18, 205, 222, 233, 90, 96,
]);
