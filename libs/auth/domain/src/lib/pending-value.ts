/**
 * Ein Wert, der von `/register` bis zum Ruecksprung aus der Mail liegen
 * bleiben muss. Warum `localStorage` und warum befristet, steht ausfuehrlich in
 * `pending-invite-code.ts`; der Einladungscode und die Zustimmung zum
 * AV-Vertrag nehmen denselben Weg.
 *
 * Jeder Wert ist an die Adresse gebunden, fuer die er eingegeben wurde. Auf
 * einem geteilten Rechner meldet sich sonst B ueber `/login` an, und der
 * Ruecksprung loest den Code von A fuer B ein oder speichert As Zustimmung als
 * die von B. Passt die Adresse nicht, wird der Wert verworfen.
 */

/** So lange wie der Magic Link gilt. */
const MAX_AGE_MS = 60 * 60 * 1000;

interface Stored {
  readonly value: string;
  readonly email: string;
  readonly savedAt: number;
}

/** Wie Supabase Adressen vergleicht: ohne Leerraum, ohne Gross/klein. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `localStorage` kann werfen (private Sitzung, blockierte Speicherung). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberPending(key: string, value: string, email: string): void {
  const entry: Stored = { value, email: normalizeEmail(email), savedAt: Date.now() };
  try {
    storage()?.setItem(key, JSON.stringify(entry));
  } catch {
    // Ohne Zwischenspeicher fragt die App spaeter erneut.
  }
}

/**
 * Liest den Wert fuer `email`, **ohne** ihn zu loeschen. Abgelaufenes,
 * Kaputtes und Werte fuer eine andere Adresse werden entfernt.
 */
export function readPending(key: string, email: string): string | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) {
      return null;
    }

    // `code` ist das Feld der aelteren Fassung (nur Einladungscode, ohne
    // Adresse): eine Registrierung, die beim Update gerade laeuft, geht so
    // nicht verloren. Solche Eintraege verfallen nach einer Stunde von selbst.
    const entry = JSON.parse(raw) as Partial<Stored> & { code?: unknown };
    const value = entry.value ?? entry.code;
    if (typeof value !== 'string' || value.length === 0) {
      forgetPending(key);
      return null;
    }
    if (typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt > MAX_AGE_MS) {
      forgetPending(key);
      return null;
    }
    // Ohne Adresse gilt nur ein Eintrag der aelteren Fassung (`code`).
    const matches =
      typeof entry.email === 'string'
        ? entry.email === normalizeEmail(email)
        : typeof entry.code === 'string';
    if (!matches) {
      forgetPending(key);
      return null;
    }
    return value;
  } catch {
    // Kaputter Inhalt ist kein Grund, die Registrierung abzubrechen.
    forgetPending(key);
    return null;
  }
}

export function forgetPending(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // nichts zu tun
  }
}
