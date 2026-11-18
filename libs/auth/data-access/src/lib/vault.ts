import { Injectable, effect, inject, untracked } from '@angular/core';

import { injectSupabase } from '@lib/shared/data-access-supabase';
import {
  DataKeyHolder,
  SALT_BYTES,
  WrapPurpose,
  WrappedKey,
  deriveWrappingKey,
  formatRecoveryKey,
  fromBase64,
  fromBase64Url,
  generateDataKey,
  generateRecoveryKey,
  lockDown,
  parseRecoveryKey,
  randomBytes,
  toBase64,
  toBase64Url,
  unwrapDataKey,
  wrapContext,
  wrapDataKey,
} from '@lib/shared/util-crypto';

import { PasskeyClient, PasskeyError, PasskeyFailure, PasskeyRef } from './passkey';
import { SessionStore } from './session';

/**
 * Wie es um den Datenschluessel des angemeldeten Kontos steht:
 * - `missing`: noch keiner eingerichtet (erste Anmeldung).
 * - `locked`: eingerichtet, aber in diesem Tab noch nicht entsperrt.
 * - `unlocked`: entsperrt, liegt im Arbeitsspeicher.
 * - `error`: liess sich nicht lesen; die Anwendung bleibt gesperrt. Nie wie
 *   `missing` behandeln — ein zweiter Datenschluessel machte die mit dem ersten
 *   verschluesselten Daten unlesbar.
 */
export type VaultStatus = 'missing' | 'locked' | 'unlocked' | 'error';

/** Ausgang von Entsperren und neuem Passkey. */
export type VaultOutcome = 'ok' | PasskeyFailure | 'wrong-key' | 'save-failed';

/**
 * Warum das Einrichten nicht weitergeht:
 * - `busy-elsewhere`: ein anderer Tab richtet gerade ein.
 * - `already-set-up`: inzwischen ist ein Schluessel da — weiter zum Entsperren.
 */
export type SetUpFailure = PasskeyFailure | 'busy-elsewhere' | 'already-set-up' | 'save-failed';

/** Der naechste Schritt beim Einrichten. */
export type SetUpStep =
  | { readonly step: 'confirm-passkey' }
  | { readonly step: 'show-recovery'; readonly recoveryKey: string }
  | { readonly step: 'done' }
  | { readonly step: 'failed'; readonly reason: SetUpFailure };

export type RecoveryOutcome = 'ok' | 'invalid' | 'wrong-key' | 'failed';

interface KeyRow {
  readonly kind: string;
  readonly credential_id: string | null;
  readonly salt: string;
  readonly iv: string;
  readonly wrapped_key: string;
}

/** Ein begonnenes Einrichten, nur im Arbeitsspeicher, bis es gespeichert ist. */
interface PendingSetUp {
  readonly userId: string;
  readonly dataKey: CryptoKey;
  readonly prfSalt: Uint8Array<ArrayBuffer>;
  readonly credentialId: Uint8Array<ArrayBuffer>;
  readonly recoveryBytes: Uint8Array<ArrayBuffer>;
  rows: readonly KeyRow[] | null;
  readonly release: () => void;
}

/** Name der Web Lock, die das Einrichten ueber alle Tabs eines Browsers serialisiert. */
const SETUP_LOCK = 'dailyfi-vault-setup';

/**
 * Schluesselverwaltung der Ende-zu-Ende-Verschluesselung.
 *
 * Einrichten in drei Schritten: `beginSetUp` legt den Passkey an (unter einer
 * Web Lock, nach erneutem Blick in `user_keys`), `confirmPasskey` holt bei
 * Safari das PRF-Ergebnis auf einen zweiten Klick nach, `finishSetUp`
 * speichert — erst nachdem der Nutzer den Wiederherstellungsschluessel
 * gesehen und das Aufbewahren bestaetigt hat. Bricht er vorher ab, ist nichts
 * gespeichert und das Einrichten beginnt beim naechsten Mal von vorn; der
 * schon angelegte Passkey wird dann ersetzt (gleiche `user.id`).
 *
 * Entsperren holt das PRF-Ergebnis des Passkeys (oder nimmt den
 * Wiederherstellungsschluessel), packt aus und legt den Schluessel in
 * `DataKeyHolder` — nur im Arbeitsspeicher, bis zum Neuladen oder Abmelden.
 */
@Injectable({ providedIn: 'root' })
export class VaultStore {
  private readonly db = injectSupabase();
  private readonly session = inject(SessionStore);
  private readonly passkeys = inject(PasskeyClient);
  private readonly holder = inject(DataKeyHolder);

  /** Gelesene Zeilen, je Konto. Neue kommen nur durch diese Klasse hinzu. */
  private rows: { readonly userId: string; readonly rows: readonly KeyRow[] } | null = null;

  private pending: PendingSetUp | null = null;

  /**
   * Nach der Wiederherstellung: der Datenschluessel, noch exportierbar, damit
   * ein neuer Passkey ihn verpacken kann. So kurz wie moeglich halten
   * (`forgetRecovered`).
   */
  private recovered: { readonly userId: string; readonly key: CryptoKey } | null = null;

  constructor() {
    // Ein Kontowechsel oder Abmelden nimmt alles mit, was zum alten Konto gehoert.
    // Mit dem Konto von jetzt beginnen: der erste Lauf des Effekts kommt
    // spaeter und darf ein inzwischen begonnenes Einrichten nicht verwerfen.
    let lastUserId = untracked(() => this.session.user()?.id ?? null);
    effect(() => {
      const userId = this.session.user()?.id ?? null;
      if (userId !== lastUserId) {
        lastUserId = userId;
        untracked(() => {
          this.rows = null;
          this.forgetRecovered();
          this.abandonSetUp();
        });
      }
    });
  }

  /** Ob WebAuthn ueberhaupt da ist. Ob PRF geht, zeigt erst `beginSetUp`. */
  passkeysAvailable(): boolean {
    return this.passkeys.isAvailable();
  }

  async status(): Promise<VaultStatus> {
    await this.session.restore();
    if (this.holder.unlocked()) {
      return 'unlocked';
    }
    const rows = await this.loadRows();
    if (rows === null) {
      return 'error';
    }
    return rows.length === 0 ? 'missing' : 'locked';
  }

  /** Erster Schritt: Sperre nehmen, nachsehen, Passkey anlegen. */
  async beginSetUp(): Promise<SetUpStep> {
    const user = this.session.user();
    if (!user) {
      return failed('failed');
    }
    this.abandonSetUp();

    if (!(await this.passkeys.supportsPrf())) {
      return failed('unsupported');
    }

    const release = await acquireSetUpLock();
    if (!release) {
      return failed('busy-elsewhere');
    }

    // Unter der Sperre noch einmal frisch lesen: ein anderer Tab kann gerade
    // fertig geworden sein. Ein neuer Passkey ersetzte dann seinen.
    const existing = await this.loadRows({ fresh: true });
    if (existing === null || existing.length > 0) {
      release();
      return failed(existing === null ? 'failed' : 'already-set-up');
    }

    const prfSalt = randomBytes(SALT_BYTES);
    let created;
    try {
      created = await this.passkeys.create({ id: user.id, name: user.email }, prfSalt);
    } catch (error) {
      release();
      return failed(failureOf(error));
    }

    this.pending = {
      userId: user.id,
      dataKey: await generateDataKey(),
      prfSalt,
      credentialId: created.credentialId,
      recoveryBytes: generateRecoveryKey(),
      rows: null,
      release,
    };

    if (!created.secret) {
      return { step: 'confirm-passkey' };
    }
    return this.prepareRows(created.secret);
  }

  /** Nur bei Safari: das PRF-Ergebnis des eben angelegten Passkeys, auf eigenen Klick. */
  async confirmPasskey(): Promise<SetUpStep> {
    const pending = this.currentPending();
    if (!pending) {
      return failed('failed');
    }
    let result;
    try {
      result = await this.passkeys.evaluate([
        { credentialId: pending.credentialId, prfSalt: pending.prfSalt },
      ]);
    } catch (error) {
      // Der Passkey bleibt angelegt; ein weiterer Klick versucht es noch einmal.
      return failed(failureOf(error));
    }
    if (toBase64Url(result.credentialId) !== toBase64Url(pending.credentialId)) {
      return failed('failed');
    }
    return this.prepareRows(result.secret);
  }

  /**
   * Letzter Schritt: beide Zeilen in einer Anweisung speichern und entsperren.
   * Kommt die Antwort nicht an, obwohl gespeichert wurde, zeigt ein erneutes
   * Lesen das: dann ist alles gut.
   */
  async finishSetUp(): Promise<SetUpStep> {
    const pending = this.currentPending();
    if (!pending?.rows) {
      return failed('failed');
    }

    const { error } = await this.db.from('user_keys').insert([...pending.rows]);
    if (error) {
      const stored = await this.loadRows({ fresh: true });
      const ours = toBase64Url(pending.credentialId);
      if (!stored?.some((row) => row.credential_id === ours)) {
        if (stored && stored.length > 0) {
          this.abandonSetUp();
          return failed('already-set-up');
        }
        // Nichts gespeichert: `pending` bleibt, ein Klick versucht es erneut.
        return failed('save-failed');
      }
    }
    if (this.currentPending() !== pending) {
      return failed('failed');
    }

    this.rows = { userId: pending.userId, rows: pending.rows };
    this.holder.set(await lockDown(pending.dataKey));
    this.abandonSetUp();
    return { step: 'done' };
  }

  /** Einrichten verwerfen, bevor es gespeichert ist. Gibt die Sperre frei. */
  abandonSetUp(): void {
    const pending = this.pending;
    this.pending = null;
    pending?.release();
  }

  async unlockWithPasskey(): Promise<VaultOutcome> {
    const userId = this.session.user()?.id;
    const rows = await this.loadRows();
    if (!userId || rows === null) {
      return 'failed';
    }

    const refs: PasskeyRef[] = rows.flatMap((row) =>
      row.kind === 'passkey' && row.credential_id
        ? [{ credentialId: fromBase64Url(row.credential_id), prfSalt: fromBase64(row.salt) }]
        : [],
    );
    if (refs.length === 0) {
      return 'failed';
    }

    let result;
    try {
      result = await this.passkeys.evaluate(refs);
    } catch (error) {
      return failureOf(error);
    }

    const credentialId = toBase64Url(result.credentialId);
    const row = rows.find((candidate) => candidate.credential_id === credentialId);
    if (!row) {
      return 'wrong-key';
    }
    try {
      const key = await unwrapDataKey(
        fromRow(row),
        await deriveWrappingKey(result.secret, fromBase64(row.salt), 'passkey'),
        wrapContext(userId, 'passkey', credentialId),
      );
      if (this.session.user()?.id !== userId) {
        return 'failed';
      }
      this.holder.set(key);
      return 'ok';
    } catch {
      return 'wrong-key';
    }
  }

  async unlockWithRecoveryKey(text: string): Promise<RecoveryOutcome> {
    const bytes = parseRecoveryKey(text);
    if (!bytes) {
      return 'invalid';
    }
    const userId = this.session.user()?.id;
    const row = (await this.loadRows())?.find((candidate) => candidate.kind === 'recovery');
    if (!userId || !row) {
      return 'failed';
    }

    let key: CryptoKey;
    try {
      key = await unwrapDataKey(
        fromRow(row),
        await deriveWrappingKey(bytes, fromBase64(row.salt), 'recovery'),
        wrapContext(userId, 'recovery', null),
        true,
      );
    } catch {
      return 'wrong-key';
    } finally {
      bytes.fill(0);
    }
    if (this.session.user()?.id !== userId) {
      return 'failed';
    }
    this.recovered = { userId, key };
    this.holder.set(await lockDown(key));
    return 'ok';
  }

  /** Nach der Wiederherstellung: ist ein neuer Passkey jetzt moeglich? */
  canAddPasskey(): boolean {
    return this.recovered !== null && this.recovered.userId === this.session.user()?.id;
  }

  /** Den exportierbaren Schluessel aus der Wiederherstellung vergessen. */
  forgetRecovered(): void {
    this.recovered = null;
  }

  /** Neuer Passkey fuer den wiederhergestellten Datenschluessel. */
  async addPasskey(): Promise<VaultOutcome> {
    const user = this.session.user();
    const recovered = this.recovered;
    if (!user || !recovered || recovered.userId !== user.id) {
      return 'failed';
    }

    const prfSalt = randomBytes(SALT_BYTES);
    let credentialId: Uint8Array<ArrayBuffer>;
    let secret: Uint8Array<ArrayBuffer>;
    try {
      const created = await this.passkeys.create({ id: user.id, name: user.email }, prfSalt);
      credentialId = created.credentialId;
      secret = created.secret ?? (await this.passkeys.evaluate([{ credentialId, prfSalt }])).secret;
    } catch (error) {
      return failureOf(error);
    }

    const row = await passkeyRow(recovered.key, user.id, credentialId, prfSalt, secret);
    const { error } = await this.db.from('user_keys').insert([row]);
    if (error) {
      return 'save-failed';
    }
    this.forgetRecovered();
    if (this.rows?.userId === user.id) {
      this.rows = { userId: user.id, rows: [...this.rows.rows, row] };
    }
    return 'ok';
  }

  private async prepareRows(secret: Uint8Array<ArrayBuffer>): Promise<SetUpStep> {
    const pending = this.currentPending();
    if (!pending) {
      return failed('failed');
    }
    const recoverySalt = randomBytes(SALT_BYTES);
    pending.rows = [
      await passkeyRow(
        pending.dataKey,
        pending.userId,
        pending.credentialId,
        pending.prfSalt,
        secret,
      ),
      toRow(
        'recovery',
        null,
        recoverySalt,
        await wrapDataKey(
          pending.dataKey,
          await deriveWrappingKey(pending.recoveryBytes, recoverySalt, 'recovery'),
          wrapContext(pending.userId, 'recovery', null),
        ),
      ),
    ];
    return { step: 'show-recovery', recoveryKey: formatRecoveryKey(pending.recoveryBytes) };
  }

  /** Das begonnene Einrichten, sofern es noch zum angemeldeten Konto gehoert. */
  private currentPending(): PendingSetUp | null {
    return this.pending && this.pending.userId === this.session.user()?.id ? this.pending : null;
  }

  /** Zeilen des angemeldeten Kontos; `null` bei einem Lesefehler. */
  private async loadRows(options: { fresh?: boolean } = {}): Promise<readonly KeyRow[] | null> {
    const userId = this.session.user()?.id;
    if (!userId) {
      return null;
    }
    if (!options.fresh && this.rows?.userId === userId) {
      return this.rows.rows;
    }

    const { data, error } = await this.db
      .from('user_keys')
      .select('kind, credential_id, salt, iv, wrapped_key');

    if (error || this.session.user()?.id !== userId) {
      return null;
    }
    const rows = data ?? [];
    // Leer nicht merken: sonst bliebe ein in einem anderen Tab eingerichteter
    // Schluessel hier unsichtbar.
    if (rows.length > 0) {
      this.rows = { userId, rows };
    }
    return rows;
  }
}

/**
 * Die Web Lock fuer das Einrichten, ohne zu warten. `null`, wenn ein anderer
 * Tab sie haelt. Ohne Locks-API (aeltere Browser) geht es ohne Sperre weiter;
 * die Datenbank laesst trotzdem nur einen Satz Schluessel je Konto zu.
 */
function acquireSetUpLock(): Promise<(() => void) | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.request) {
    return Promise.resolve(() => undefined);
  }
  return new Promise((resolve) => {
    void locks.request(SETUP_LOCK, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return undefined;
      }
      // Gehalten, bis `release` laeuft — oder der Tab geschlossen wird.
      return new Promise<void>((release) => resolve(() => release()));
    });
  });
}

async function passkeyRow(
  dataKey: CryptoKey,
  userId: string,
  credentialId: Uint8Array,
  prfSalt: Uint8Array<ArrayBuffer>,
  secret: Uint8Array<ArrayBuffer>,
): Promise<KeyRow> {
  const id = toBase64Url(credentialId);
  const wrapped = await wrapDataKey(
    dataKey,
    await deriveWrappingKey(secret, prfSalt, 'passkey'),
    wrapContext(userId, 'passkey', id),
  );
  return toRow('passkey', id, prfSalt, wrapped);
}

function toRow(
  kind: WrapPurpose,
  credentialId: string | null,
  salt: Uint8Array,
  key: WrappedKey,
): KeyRow {
  return {
    kind,
    credential_id: credentialId,
    salt: toBase64(salt),
    iv: toBase64(key.iv),
    wrapped_key: toBase64(key.wrapped),
  };
}

function fromRow(row: KeyRow): WrappedKey {
  return { wrapped: fromBase64(row.wrapped_key), iv: fromBase64(row.iv) };
}

function failed(reason: SetUpFailure): SetUpStep {
  return { step: 'failed', reason };
}

function failureOf(error: unknown): PasskeyFailure {
  return error instanceof PasskeyError ? error.reason : 'failed';
}
