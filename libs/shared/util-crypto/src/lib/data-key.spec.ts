import { randomBytes } from './bytes';
import {
  SALT_BYTES,
  deriveWrappingKey,
  generateDataKey,
  lockDown,
  unwrapDataKey,
  wrapContext,
  wrapDataKey,
} from './data-key';

const CONTEXT = wrapContext('u1', 'passkey', 'cred-1');

async function roundTrip(key: CryptoKey, other: CryptoKey): Promise<string> {
  const iv = randomBytes(12);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode('Kunde A'),
  );
  const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, other, sealed);
  return new TextDecoder().decode(opened);
}

describe('Datenschluessel', () => {
  it('kommt mit demselben Geheimnis wieder heraus', async () => {
    const dataKey = await generateDataKey();
    const secret = randomBytes(32);
    const salt = randomBytes(SALT_BYTES);

    const wrapped = await wrapDataKey(
      dataKey,
      await deriveWrappingKey(secret, salt, 'passkey'),
      CONTEXT,
    );
    const unwrapped = await unwrapDataKey(
      wrapped,
      await deriveWrappingKey(secret, salt, 'passkey'),
      CONTEXT,
    );

    await expect(roundTrip(dataKey, unwrapped)).resolves.toBe('Kunde A');
    expect(unwrapped.extractable).toBe(false);
  });

  it('bleibt mit falschem Geheimnis, Salt oder Zweck verschlossen', async () => {
    const dataKey = await generateDataKey();
    const secret = randomBytes(32);
    const salt = randomBytes(SALT_BYTES);
    const wrapped = await wrapDataKey(
      dataKey,
      await deriveWrappingKey(secret, salt, 'passkey'),
      CONTEXT,
    );

    for (const wrong of [
      deriveWrappingKey(randomBytes(32), salt, 'passkey'),
      deriveWrappingKey(secret, randomBytes(SALT_BYTES), 'passkey'),
      deriveWrappingKey(secret, salt, 'recovery'),
    ]) {
      await expect(unwrapDataKey(wrapped, await wrong, CONTEXT)).rejects.toBeDefined();
    }
  });

  it('laesst sich nicht in ein anderes Konto oder auf einen anderen Passkey uebertragen', async () => {
    const dataKey = await generateDataKey();
    const wrappingKey = await deriveWrappingKey(
      randomBytes(32),
      randomBytes(SALT_BYTES),
      'passkey',
    );
    const wrapped = await wrapDataKey(dataKey, wrappingKey, CONTEXT);

    for (const context of [
      wrapContext('u2', 'passkey', 'cred-1'),
      wrapContext('u1', 'passkey', 'cred-2'),
      wrapContext('u1', 'recovery', null),
    ]) {
      await expect(unwrapDataKey(wrapped, wrappingKey, context)).rejects.toBeDefined();
    }
  });

  it('macht fuer den Arbeitsspeicher eine nicht exportierbare Kopie', async () => {
    const dataKey = await generateDataKey();

    const locked = await lockDown(dataKey);

    expect(dataKey.extractable).toBe(true);
    expect(locked.extractable).toBe(false);
    await expect(roundTrip(dataKey, locked)).resolves.toBe('Kunde A');
  });
});
