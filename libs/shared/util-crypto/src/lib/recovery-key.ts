import { randomBytes } from './bytes';

/**
 * Der Wiederherstellungsschluessel: 32 Zufallsbytes, die der Nutzer selbst
 * aufbewahrt. Mit ihm kommt er an seine Daten, wenn der Passkey fehlt.
 *
 * Geschrieben in Base32 ohne I, L, O und U (wie die Einladungscodes), in
 * Vierergruppen: 256 Bit sind 52 Zeichen. Beim Einlesen zaehlen Gross- und
 * Kleinschreibung, Leerzeichen und Striche nicht, und die leicht verwechselten
 * Zeichen werden wohlwollend gelesen (O als 0, I und L als 1).
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_KEY_BYTES = 32;
const CHARS = Math.ceil((RECOVERY_KEY_BYTES * 8) / 5);

export function generateRecoveryKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(RECOVERY_KEY_BYTES);
}

export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return (out.match(/.{1,4}/g) ?? []).join('-');
}

/** `null`, wenn die Eingabe kein Wiederherstellungsschluessel sein kann. */
export function parseRecoveryKey(text: string): Uint8Array<ArrayBuffer> | null {
  const chars = text.toUpperCase().replace(/[\s-]/g, '').replaceAll('O', '0').replace(/[IL]/g, '1');
  if (chars.length !== CHARS) {
    return null;
  }

  const bytes = new Uint8Array(RECOVERY_KEY_BYTES);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of chars) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) {
      return null;
    }
    value = ((value << 5) | digit) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      if (index < RECOVERY_KEY_BYTES) {
        bytes[index++] = (value >>> (bits - 8)) & 0xff;
      }
      bits -= 8;
    }
  }
  // Die letzten Fuellbits sind beim Schreiben null; sonst ist es ein Vertipper.
  return (value & ((1 << bits) - 1)) === 0 ? bytes : null;
}
