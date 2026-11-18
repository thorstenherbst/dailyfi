import { randomBytes } from './bytes';

/**
 * Der Datenschluessel eines Kontos und seine Verpackung.
 *
 * Jedes Konto hat genau einen Datenschluessel (AES-256-GCM), mit dem die
 * Inhalte verschluesselt werden. Er verlaesst den Browser nie im Klartext: in
 * der Datenbank liegt er nur verpackt, einmal je Passkey und einmal mit dem
 * Wiederherstellungsschluessel. Den Schluessel zum Verpacken leitet HKDF aus
 * einem Geheimnis ab, das nur der Nutzer hat — dem PRF-Ergebnis des Passkeys
 * oder den 32 Bytes des Wiederherstellungsschluessels. Beide haben volle
 * 256 Bit Zufall, ein langsames Verfahren wie PBKDF2 braucht es deshalb nicht.
 */

/** Wofuer ein Verpackungsschluessel abgeleitet wird; geht als `info` in HKDF. */
export type WrapPurpose = 'passkey' | 'recovery';

/** Ein verpackter Datenschluessel, so wie er in `user_keys` steht. */
export interface WrappedKey {
  readonly wrapped: Uint8Array<ArrayBuffer>;
  readonly iv: Uint8Array<ArrayBuffer>;
}

const AES = { name: 'AES-GCM', length: 256 } as const;

/** Laenge der Zufallswerte fuer HKDF-Salt und PRF-Eingabe. */
export const SALT_BYTES = 32;

/**
 * Neuer Datenschluessel. Exportierbar, weil er gleich danach zweimal verpackt
 * wird; im Arbeitsspeicher liegt danach nur eine nicht exportierbare Kopie
 * (`unwrapDataKey`).
 */
export function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(AES, true, ['encrypt', 'decrypt']);
}

/** Verpackungsschluessel aus Geheimnis und Salt (HKDF-SHA-256). */
export async function deriveWrappingKey(
  secret: BufferSource,
  salt: BufferSource,
  purpose: WrapPurpose,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode(`dailyfi/data-key/${purpose}/v1`),
    },
    material,
    AES,
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Wozu eine Verpackung gehoert — Konto, Art und Passkey. Geht als
 * `additionalData` in AES-GCM: eine Zeile, die in ein anderes Konto oder auf
 * einen anderen Passkey kopiert wird, laesst sich dort nicht auspacken.
 */
export function wrapContext(
  userId: string,
  kind: WrapPurpose,
  credentialId: string | null,
): string {
  return `dailyfi/v1|${userId}|${kind}|${credentialId ?? ''}`;
}

export async function wrapDataKey(
  dataKey: CryptoKey,
  wrappingKey: CryptoKey,
  context: string,
): Promise<WrappedKey> {
  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.wrapKey('raw', dataKey, wrappingKey, {
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(context),
  });
  return { wrapped: new Uint8Array(wrapped), iv };
}

/**
 * Packt den Datenschluessel aus. Passt der Verpackungsschluessel nicht
 * (falscher Wiederherstellungsschluessel, anderer Passkey), scheitert die
 * Pruefsumme von AES-GCM, und das Versprechen wird abgelehnt.
 *
 * `extractable` nur, wenn der Schluessel gleich neu verpackt werden muss —
 * etwa fuer einen neuen Passkey nach der Wiederherstellung.
 */
export function unwrapDataKey(
  key: WrappedKey,
  wrappingKey: CryptoKey,
  context: string,
  extractable = false,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    key.wrapped,
    wrappingKey,
    { name: 'AES-GCM', iv: key.iv, additionalData: new TextEncoder().encode(context) },
    AES,
    extractable,
    ['encrypt', 'decrypt'],
  );
}

/** Eine nicht exportierbare Kopie fuer den Arbeitsspeicher. */
export async function lockDown(dataKey: CryptoKey): Promise<CryptoKey> {
  if (!dataKey.extractable) {
    return dataKey;
  }
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dataKey));
  try {
    return await crypto.subtle.importKey('raw', raw, AES, false, ['encrypt', 'decrypt']);
  } finally {
    // Die Bytes nicht laenger als noetig im Speicher der Seite stehen lassen.
    raw.fill(0);
  }
}
