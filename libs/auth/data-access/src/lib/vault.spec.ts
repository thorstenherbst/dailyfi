import { TestBed } from '@angular/core/testing';

import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';
import { DataKeyHolder, randomBytes } from '@lib/shared/util-crypto';

import { CreatedPasskey, PasskeyClient, PasskeyError, PasskeyRef, PrfResult } from './passkey';
import { SessionStore } from './session';
import { SetUpStep, VaultStore } from './vault';

const USER = { id: 'u1', email: 'thorsten@dailyfi.test' };

/**
 * Passkeys wie im Browser, nur ohne Browser: jeder hat ein eigenes Geheimnis,
 * und sein PRF-Ergebnis haengt von Geheimnis und Eingabe ab — dieselbe
 * Eingabe liefert immer dasselbe.
 */
class FakePasskeys {
  readonly secrets = new Map<string, Uint8Array<ArrayBuffer>>();
  /** Wie Safari: beim Anlegen kein PRF-Ergebnis, erst bei der Abfrage. */
  resultsOnCreate = true;
  prfSupported = true;
  /** Welcher Passkey bei der naechsten Abfrage antwortet; Standard: der erste passende. */
  answerWith: Uint8Array<ArrayBuffer> | null = null;
  failWith: PasskeyError | null = null;
  created = 0;

  isAvailable(): boolean {
    return true;
  }

  async supportsPrf(): Promise<boolean> {
    return this.prfSupported;
  }

  async create(_account: unknown, prfSalt: Uint8Array<ArrayBuffer>): Promise<CreatedPasskey> {
    if (this.failWith) {
      throw this.failWith;
    }
    this.created += 1;
    const credentialId = randomBytes(16);
    this.secrets.set(key(credentialId), randomBytes(32));
    return {
      credentialId,
      secret: this.resultsOnCreate ? await this.prf(credentialId, prfSalt) : null,
    };
  }

  async evaluate(passkeys: readonly PasskeyRef[]): Promise<PrfResult> {
    if (this.failWith) {
      throw this.failWith;
    }
    const chosen = this.answerWith
      ? { credentialId: this.answerWith, prfSalt: passkeys[0].prfSalt }
      : passkeys.find((passkey) => this.secrets.has(key(passkey.credentialId)));
    if (!chosen) {
      throw new PasskeyError('cancelled');
    }
    return {
      credentialId: chosen.credentialId,
      secret: await this.prf(chosen.credentialId, chosen.prfSalt),
    };
  }

  private async prf(credentialId: Uint8Array, salt: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const secret = this.secrets.get(key(credentialId)) ?? new Uint8Array(32);
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array([...secret, ...salt]));
    return new Uint8Array(digest);
  }
}

function key(bytes: Uint8Array): string {
  return [...bytes].join(',');
}

function configure(fake: FakeSupabase, passkeys: FakePasskeys): void {
  TestBed.configureTestingModule({
    providers: [
      { provide: SUPABASE, useValue: fake.asClient() },
      { provide: PasskeyClient, useValue: passkeys },
    ],
  });
}

async function setup(adjust: (fake: FakeSupabase, passkeys: FakePasskeys) => void = () => {}) {
  const fake = new FakeSupabase();
  fake.user = USER;
  fake.betaAccess = true;
  const passkeys = new FakePasskeys();
  adjust(fake, passkeys);
  configure(fake, passkeys);
  await TestBed.inject(SessionStore).restore();
  TestBed.tick();

  return {
    fake,
    passkeys,
    vault: TestBed.inject(VaultStore),
    holder: TestBed.inject(DataKeyHolder),
  };
}

/** Wie ein Neuladen: neuer Store, Arbeitsspeicher leer, Datenbank und Passkeys bleiben. */
async function reload(fake: FakeSupabase, passkeys: FakePasskeys) {
  TestBed.resetTestingModule();
  configure(fake, passkeys);
  await TestBed.inject(SessionStore).restore();
  TestBed.tick();
  return { vault: TestBed.inject(VaultStore), holder: TestBed.inject(DataKeyHolder) };
}

/** Der ganze Weg bis „eingerichtet"; liefert den Wiederherstellungsschluessel. */
async function setUpFully(vault: VaultStore): Promise<string> {
  let step: SetUpStep = await vault.beginSetUp();
  if (step.step === 'confirm-passkey') {
    step = await vault.confirmPasskey();
  }
  if (step.step !== 'show-recovery') {
    throw new Error(`Unerwarteter Schritt: ${JSON.stringify(step)}`);
  }
  const done = await vault.finishSetUp();
  expect(done).toEqual({ step: 'done' });
  return step.recoveryKey;
}

async function seal(key: CryptoKey, text: string) {
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  );
  return { iv, data };
}

async function open(key: CryptoKey, sealed: { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data);
  return new TextDecoder().decode(plain);
}

describe('VaultStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('meldet ein Konto ohne Schluessel als nicht eingerichtet', async () => {
    const { vault } = await setup();

    await expect(vault.status()).resolves.toBe('missing');
  });

  describe('Einrichten', () => {
    it('speichert erst nach dem Zeigen des Wiederherstellungsschluessels', async () => {
      const { fake, vault, holder } = await setup();

      const step = await vault.beginSetUp();

      expect(step.step).toBe('show-recovery');
      expect(step.step === 'show-recovery' && step.recoveryKey).toMatch(
        /^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/,
      );
      // Noch nichts gespeichert, noch nicht entsperrt.
      expect(fake.userKeys).toEqual([]);
      expect(holder.unlocked()).toBe(false);

      await expect(vault.finishSetUp()).resolves.toEqual({ step: 'done' });

      expect(fake.userKeys.map((row) => row['kind'])).toEqual(['passkey', 'recovery']);
      expect(holder.unlocked()).toBe(true);
      expect(holder.require().extractable).toBe(false);
      await expect(vault.status()).resolves.toBe('unlocked');
    });

    it('legt nichts ab, was der Schluessel oder der Wiederherstellungsschluessel waere', async () => {
      const { fake, vault } = await setup();

      const recoveryKey = await setUpFully(vault);

      const stored = JSON.stringify(fake.userKeys);
      expect(stored.includes(recoveryKey)).toBe(false);
      expect(stored.includes(recoveryKey.replaceAll('-', ''))).toBe(false);
    });

    it('fragt bei Safari den Passkey in einem zweiten Schritt', async () => {
      const { vault } = await setup((_fake, passkeys) => {
        passkeys.resultsOnCreate = false;
      });

      await expect(vault.beginSetUp()).resolves.toEqual({ step: 'confirm-passkey' });
      const step = await vault.confirmPasskey();

      expect(step.step).toBe('show-recovery');
    });

    it('verwirft ein abgebrochenes Einrichten vollstaendig', async () => {
      const { fake, vault, holder } = await setup();
      await vault.beginSetUp();

      vault.abandonSetUp();

      await expect(vault.finishSetUp()).resolves.toEqual({ step: 'failed', reason: 'failed' });
      expect(fake.userKeys).toEqual([]);
      expect(holder.unlocked()).toBe(false);
    });

    it('legt keinen Passkey an, wenn der Browser PRF verneint', async () => {
      const { passkeys, vault } = await setup((_fake, p) => {
        p.prfSupported = false;
      });

      await expect(vault.beginSetUp()).resolves.toEqual({ step: 'failed', reason: 'unsupported' });
      expect(passkeys.created).toBe(0);
    });

    it('reicht Abbruch und fehlendes PRF beim Anlegen durch', async () => {
      for (const reason of ['cancelled', 'unsupported'] as const) {
        TestBed.resetTestingModule();
        const { fake, vault } = await setup((_fake, passkeys) => {
          passkeys.failWith = new PasskeyError(reason);
        });

        await expect(vault.beginSetUp()).resolves.toEqual({ step: 'failed', reason });
        expect(fake.userKeys).toEqual([]);
      }
    });

    it('legt keinen zweiten Passkey an, wenn inzwischen eingerichtet ist', async () => {
      // Ein anderer Tab war schneller. Ein neuer Passkey mit derselben
      // Nutzerkennung ersetzte dessen Passkey im Schluesselbund.
      const { fake, passkeys, vault } = await setup();
      await expect(vault.status()).resolves.toBe('missing');
      fake.userKeys = [
        { kind: 'recovery', credential_id: null, salt: '', iv: '', wrapped_key: '' },
      ];

      await expect(vault.beginSetUp()).resolves.toEqual({
        step: 'failed',
        reason: 'already-set-up',
      });
      expect(passkeys.created).toBe(0);
    });

    it('erkennt beim Speichern, dass ein anderer Tab schon eingerichtet hat', async () => {
      const { fake, vault, holder } = await setup();
      await vault.beginSetUp();
      fake.userKeys = [
        { kind: 'recovery', credential_id: null, salt: '', iv: '', wrapped_key: '' },
      ];

      await expect(vault.finishSetUp()).resolves.toEqual({
        step: 'failed',
        reason: 'already-set-up',
      });
      expect(fake.userKeys).toHaveLength(1);
      expect(holder.unlocked()).toBe(false);
    });

    it('nimmt ein Speichern an, dessen Antwort verloren ging', async () => {
      const { fake, vault, holder } = await setup((f) => {
        f.userKeysInsertLosesResponse = true;
      });
      await vault.beginSetUp();

      await expect(vault.finishSetUp()).resolves.toEqual({ step: 'done' });
      expect(fake.userKeys).toHaveLength(2);
      expect(holder.unlocked()).toBe(true);
    });

    it('laesst nach einem gescheiterten Speichern einen zweiten Versuch zu', async () => {
      const { fake, vault } = await setup((f) => {
        f.userKeysInsertError = { message: 'connection reset' };
      });
      await vault.beginSetUp();

      await expect(vault.finishSetUp()).resolves.toEqual({
        step: 'failed',
        reason: 'save-failed',
      });
      fake.userKeysInsertError = null;
      await expect(vault.finishSetUp()).resolves.toEqual({ step: 'done' });
    });

    it('verwirft ein begonnenes Einrichten beim Kontowechsel', async () => {
      const { fake, vault } = await setup();
      await vault.beginSetUp();

      fake.emitAuthEvent('SIGNED_IN', { id: 'u2', email: 'andere@dailyfi.test' });
      TestBed.tick();

      await expect(vault.finishSetUp()).resolves.toEqual({ step: 'failed', reason: 'failed' });
      expect(fake.userKeys).toEqual([]);
    });
  });

  describe('Entsperren', () => {
    it('entsperrt nach dem Neuladen mit dem Passkey denselben Schluessel', async () => {
      const { fake, passkeys, vault, holder } = await setup();
      await setUpFully(vault);
      const sealed = await seal(holder.require(), 'Kunde A');

      const next = await reload(fake, passkeys);
      await expect(next.vault.status()).resolves.toBe('locked');
      await expect(next.vault.unlockWithPasskey()).resolves.toBe('ok');

      await expect(open(next.holder.require(), sealed)).resolves.toBe('Kunde A');
    });

    it('entsperrt mit dem Wiederherstellungsschluessel denselben Schluessel', async () => {
      const { fake, passkeys, vault, holder } = await setup();
      const recoveryKey = await setUpFully(vault);
      const sealed = await seal(holder.require(), 'Kunde A');

      const next = await reload(fake, passkeys);
      await expect(next.vault.unlockWithRecoveryKey(recoveryKey.toLowerCase())).resolves.toBe('ok');

      await expect(open(next.holder.require(), sealed)).resolves.toBe('Kunde A');
      expect(next.holder.require().extractable).toBe(false);
    });

    it('legt nach der Wiederherstellung einen neuen Passkey an, der danach entsperrt', async () => {
      const { fake, passkeys, vault, holder } = await setup();
      const recoveryKey = await setUpFully(vault);
      const sealed = await seal(holder.require(), 'Kunde A');
      // Der alte Passkey ist weg (neues Geraet).
      passkeys.secrets.clear();

      const next = await reload(fake, passkeys);
      await next.vault.unlockWithRecoveryKey(recoveryKey);
      expect(next.vault.canAddPasskey()).toBe(true);
      await expect(next.vault.addPasskey()).resolves.toBe('ok');
      expect(fake.userKeys.filter((row) => row['kind'] === 'passkey')).toHaveLength(2);
      expect(next.vault.canAddPasskey()).toBe(false);

      const third = await reload(fake, passkeys);
      await expect(third.vault.unlockWithPasskey()).resolves.toBe('ok');
      await expect(open(third.holder.require(), sealed)).resolves.toBe('Kunde A');
    });

    it('vergisst den wiederhergestellten Schluessel beim Abmelden', async () => {
      const { fake, passkeys, vault } = await setup();
      const recoveryKey = await setUpFully(vault);
      const next = await reload(fake, passkeys);
      await next.vault.unlockWithRecoveryKey(recoveryKey);

      await TestBed.inject(SessionStore).signOut();
      TestBed.tick();

      expect(next.vault.canAddPasskey()).toBe(false);
      expect(next.holder.unlocked()).toBe(false);
    });

    it('weist einen falschen oder unlesbaren Wiederherstellungsschluessel ab', async () => {
      const { fake, passkeys, vault } = await setup();
      await setUpFully(vault);
      const next = await reload(fake, passkeys);

      await expect(next.vault.unlockWithRecoveryKey('ABCD')).resolves.toBe('invalid');
      await expect(next.vault.unlockWithRecoveryKey('0'.repeat(52))).resolves.toBe('wrong-key');
      expect(next.holder.unlocked()).toBe(false);
    });

    it('erkennt einen Passkey, der nicht zum Konto gehoert', async () => {
      const { fake, passkeys, vault } = await setup();
      await setUpFully(vault);
      const next = await reload(fake, passkeys);
      passkeys.answerWith = randomBytes(16);

      await expect(next.vault.unlockWithPasskey()).resolves.toBe('wrong-key');
      expect(next.holder.unlocked()).toBe(false);
    });

    it('erkennt eine Zeile, die in ein anderes Konto kopiert wurde', async () => {
      const { fake, passkeys, vault } = await setup();
      const recoveryKey = await setUpFully(vault);

      // Dieselben Zeilen, aber jetzt fuer ein anderes Konto.
      fake.user = { id: 'u2', email: 'andere@dailyfi.test' };
      const next = await reload(fake, passkeys);

      await expect(next.vault.unlockWithPasskey()).resolves.toBe('wrong-key');
      await expect(next.vault.unlockWithRecoveryKey(recoveryKey)).resolves.toBe('wrong-key');
    });

    it('meldet einen Lesefehler, statt ein neues Einrichten anzubieten', async () => {
      // Sonst bekaeme ein Konto mit Schluessel einen zweiten und seine Daten
      // waeren mit dem ersten verschluesselt.
      const { vault } = await setup((fake) => {
        fake.userKeysReadError = { message: 'connection reset' };
      });

      await expect(vault.status()).resolves.toBe('error');
    });

    it('vergisst den Schluessel beim Abmelden', async () => {
      const { vault, holder } = await setup();
      await setUpFully(vault);

      await TestBed.inject(SessionStore).signOut();

      expect(holder.unlocked()).toBe(false);
    });
  });
});
