/**
 * Bytes fuer Datenbank und WebAuthn. Gespeichert wird als Base64 in
 * `text`-Spalten — `bytea` kommt ueber PostgREST als Hex-String zurueck und
 * muesste in beide Richtungen eigens behandelt werden.
 */

/** Frische Zufallsbytes aus `crypto.getRandomValues`. */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Base64url ohne Auffuellung — so nennt WebAuthn Credential-IDs. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  return fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}
