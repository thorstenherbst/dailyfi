import { Injectable } from '@angular/core';

import { randomBytes, toBase64Url } from '@lib/shared/util-crypto';

/** Ein Passkey, so weit `VaultStore` ihn kennt. */
export interface PasskeyRef {
  readonly credentialId: Uint8Array<ArrayBuffer>;
  /** Eingabe fuer die PRF-Erweiterung; je Passkey zufaellig, liegt in `user_keys`. */
  readonly prfSalt: Uint8Array<ArrayBuffer>;
}

/** Ergebnis einer PRF-Abfrage: welcher Passkey, und sein Geheimnis fuer genau diese Eingabe. */
export interface PrfResult {
  readonly credentialId: Uint8Array<ArrayBuffer>;
  readonly secret: Uint8Array<ArrayBuffer>;
}

/**
 * Ein frisch angelegter Passkey. `secret` fehlt, wenn der Browser das
 * PRF-Ergebnis nicht schon beim Anlegen liefert (Safari) — dann braucht es eine
 * zweite Abfrage, und zwar auf einen eigenen Klick: WebKit verbraucht die
 * Nutzergeste mit dem ersten WebAuthn-Aufruf.
 */
export interface CreatedPasskey {
  readonly credentialId: Uint8Array<ArrayBuffer>;
  readonly secret: Uint8Array<ArrayBuffer> | null;
}

/**
 * Warum WebAuthn nichts geliefert hat:
 * - `unsupported`: Browser oder Passkey kennen PRF nicht.
 * - `cancelled`: abgebrochen oder Zeit abgelaufen (WebAuthn unterscheidet das
 *   absichtlich nicht).
 * - `failed`: alles andere.
 */
export type PasskeyFailure = 'unsupported' | 'cancelled' | 'failed';

export class PasskeyError extends Error {
  constructor(readonly reason: PasskeyFailure) {
    super(`Passkey: ${reason}`);
  }
}

const TIMEOUT_MS = 120_000;

/**
 * Passkeys als Schluesselquelle, nicht als Anmeldung: angemeldet wird mit
 * Apple. Hier zaehlt nur die PRF-Erweiterung — der Passkey rechnet aus einer
 * Eingabe ein Geheimnis von 32 Bytes, das fuer dieselbe Eingabe immer gleich
 * ist und das Geraet bzw. den iCloud-Schluesselbund nie verlaesst, ausser als
 * dieses Ergebnis im Browser. Daraus wird der Verpackungsschluessel abgeleitet.
 *
 * Die Challenges sind deshalb zufaellig und werden von keinem Server geprueft:
 * es gibt nichts zu beweisen, nur etwas auszurechnen.
 *
 * Der Passkey gehoert zur Domain der Seite (`rp.id`). Zieht die Anwendung auf
 * eine andere Domain um, sind die Passkeys dort nicht mehr nutzbar — dann hilft
 * der Wiederherstellungsschluessel.
 */
@Injectable({ providedIn: 'root' })
export class PasskeyClient {
  /** Grobe Vorpruefung: ohne WebAuthn gar nicht erst anbieten. */
  isAvailable(): boolean {
    return typeof globalThis.PublicKeyCredential === 'function' && !!navigator.credentials;
  }

  /**
   * Kann der Browser PRF? `false` nur, wenn er es selbst verneint
   * (`getClientCapabilities`); kennt er die Abfrage nicht, zeigt es erst der
   * Versuch. So entsteht kein unbrauchbarer Passkey, wo es sich vorher sagen laesst.
   */
  async supportsPrf(): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }
    const probe = (
      PublicKeyCredential as unknown as {
        getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
      }
    ).getClientCapabilities;
    if (typeof probe !== 'function') {
      return true;
    }
    try {
      return (await probe.call(PublicKeyCredential))['extension:prf'] !== false;
    } catch {
      return true;
    }
  }

  /**
   * Legt einen Passkey an und fragt dabei sein PRF-Ergebnis fuer `prfSalt` an.
   *
   * `user.id` ist die Konto-ID: legt ein zweiter Versuch fuer dasselbe Konto
   * einen Passkey an, ersetzt der Schluesselbund den alten, statt dass sich
   * unbrauchbare Passkeys sammeln. Deshalb darf nie ein Passkey angelegt
   * werden, waehrend ein anderer schon in `user_keys` steht (`VaultStore`).
   */
  async create(
    account: { id: string; name: string },
    prfSalt: Uint8Array<ArrayBuffer>,
  ): Promise<CreatedPasskey> {
    const credential = await this.call(() =>
      navigator.credentials.create({
        publicKey: {
          rp: { id: globalThis.location.hostname, name: 'Dailyfi' },
          user: {
            id: new TextEncoder().encode(account.id),
            name: account.name || 'Dailyfi',
            displayName: account.name || 'Dailyfi',
          },
          challenge: randomBytes(32),
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          timeout: TIMEOUT_MS,
          extensions: { prf: { eval: { first: prfSalt } } },
        },
      }),
    );

    const prf = credential.getClientExtensionResults().prf;
    if (prf?.enabled === false) {
      throw new PasskeyError('unsupported');
    }
    const first = prf?.results?.first;
    return {
      credentialId: new Uint8Array(credential.rawId),
      secret: first ? toBytes(first) : null,
    };
  }

  /** Fragt einen der bekannten Passkeys nach seinem PRF-Ergebnis. */
  async evaluate(passkeys: readonly PasskeyRef[]): Promise<PrfResult> {
    const evalByCredential: Record<string, AuthenticationExtensionsPRFValues> = {};
    for (const passkey of passkeys) {
      evalByCredential[toBase64Url(passkey.credentialId)] = { first: passkey.prfSalt };
    }

    const credential = await this.call(() =>
      navigator.credentials.get({
        publicKey: {
          rpId: globalThis.location.hostname,
          challenge: randomBytes(32),
          allowCredentials: passkeys.map((passkey) => ({
            type: 'public-key',
            id: passkey.credentialId,
          })),
          userVerification: 'required',
          timeout: TIMEOUT_MS,
          extensions: { prf: { evalByCredential } },
        },
      }),
    );

    const first = credential.getClientExtensionResults().prf?.results?.first;
    if (!first) {
      throw new PasskeyError('unsupported');
    }
    return { credentialId: new Uint8Array(credential.rawId), secret: toBytes(first) };
  }

  private async call(request: () => Promise<Credential | null>): Promise<PublicKeyCredential> {
    if (!this.isAvailable()) {
      throw new PasskeyError('unsupported');
    }
    let credential: Credential | null;
    try {
      credential = await request();
    } catch (error) {
      // NotAllowedError heisst abgebrochen, abgelaufen — oder kein passender
      // Passkey auf diesem Geraet; WebAuthn unterscheidet das absichtlich nicht.
      throw new PasskeyError(
        error instanceof DOMException && error.name === 'NotAllowedError' ? 'cancelled' : 'failed',
      );
    }
    if (!(credential instanceof PublicKeyCredential)) {
      throw new PasskeyError('failed');
    }
    return credential;
  }
}

function toBytes(source: BufferSource): Uint8Array<ArrayBuffer> {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  return new Uint8Array(view);
}
