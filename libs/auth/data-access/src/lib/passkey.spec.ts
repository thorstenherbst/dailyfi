import { TestBed } from '@angular/core/testing';

import { toBase64Url } from '@lib/shared/util-crypto';

import { PasskeyClient, PasskeyError } from './passkey';

/** Ein `PublicKeyCredential` so weit, wie `PasskeyClient` es liest. */
class StubCredential {
  constructor(
    readonly rawId: ArrayBuffer,
    private readonly prf: Record<string, unknown> | undefined,
  ) {}
  getClientExtensionResults(): Record<string, unknown> {
    return this.prf ? { prf: this.prf } : {};
  }
}

const SALT = new Uint8Array(32).fill(7);
const ID = new Uint8Array([1, 2, 3, 250, 251, 252]);
const SECRET = new Uint8Array(32).fill(9);

function install(credentials: { create?: unknown; get?: unknown }): void {
  vi.stubGlobal('PublicKeyCredential', StubCredential);
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: credentials,
  });
}

function client(): PasskeyClient {
  return TestBed.inject(PasskeyClient);
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof PasskeyError ? error.reason : 'other';
  }
  return 'resolved';
}

describe('PasskeyClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'credentials');
  });

  it('nimmt das PRF-Ergebnis beim Anlegen (Chrome)', async () => {
    const create = vi.fn(
      async () => new StubCredential(ID.buffer, { enabled: true, results: { first: SECRET } }),
    );
    install({ create });

    const created = await client().create({ id: 'u1', name: 'a@dailyfi.test' }, SALT);

    expect(created.credentialId).toEqual(ID);
    expect(created.secret).toEqual(SECRET);
    const options = (create.mock.calls[0] as unknown as [CredentialCreationOptions])[0].publicKey!;
    expect(options.extensions?.prf?.eval?.first).toEqual(SALT);
    expect(options.authenticatorSelection?.userVerification).toBe('required');
  });

  it('meldet ohne Ergebnis beim Anlegen, dass bestaetigt werden muss (Safari)', async () => {
    install({ create: async () => new StubCredential(ID.buffer, { enabled: true }) });

    const created = await client().create({ id: 'u1', name: '' }, SALT);

    expect(created.secret).toBeNull();
  });

  it('meldet einen Passkey ohne PRF als nicht unterstuetzt', async () => {
    install({ create: async () => new StubCredential(ID.buffer, { enabled: false }) });

    await expect(failure(client().create({ id: 'u1', name: '' }, SALT))).resolves.toBe(
      'unsupported',
    );
  });

  it('fragt bekannte Passkeys mit ihrer ID in Base64url ab', async () => {
    const get = vi.fn(async () => new StubCredential(ID.buffer, { results: { first: SECRET } }));
    install({ get });

    const result = await client().evaluate([{ credentialId: ID, prfSalt: SALT }]);

    expect(result.secret).toEqual(SECRET);
    const options = (get.mock.calls[0] as unknown as [CredentialRequestOptions])[0].publicKey!;
    expect(Object.keys(options.extensions?.prf?.evalByCredential ?? {})).toEqual([toBase64Url(ID)]);
    expect(toBase64Url(ID)).not.toMatch(/[+/=]/);
  });

  it('meldet eine Abfrage ohne PRF-Ergebnis als nicht unterstuetzt', async () => {
    install({ get: async () => new StubCredential(ID.buffer, {}) });

    await expect(failure(client().evaluate([{ credentialId: ID, prfSalt: SALT }]))).resolves.toBe(
      'unsupported',
    );
  });

  it('unterscheidet Abbruch von anderen Fehlern', async () => {
    install({
      get: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    });
    await expect(failure(client().evaluate([{ credentialId: ID, prfSalt: SALT }]))).resolves.toBe(
      'cancelled',
    );

    install({
      get: async () => {
        throw new DOMException('wrong rp', 'SecurityError');
      },
    });
    await expect(failure(client().evaluate([{ credentialId: ID, prfSalt: SALT }]))).resolves.toBe(
      'failed',
    );
  });

  it('gibt ohne WebAuthn gleich auf', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);

    expect(client().isAvailable()).toBe(false);
    await expect(client().supportsPrf()).resolves.toBe(false);
    await expect(failure(client().evaluate([{ credentialId: ID, prfSalt: SALT }]))).resolves.toBe(
      'unsupported',
    );
  });

  it('verlaesst sich auf getClientCapabilities, wo es das gibt', async () => {
    install({});
    (StubCredential as unknown as { getClientCapabilities?: unknown }).getClientCapabilities =
      async () => ({ 'extension:prf': false });
    try {
      await expect(client().supportsPrf()).resolves.toBe(false);
    } finally {
      delete (StubCredential as unknown as { getClientCapabilities?: unknown })
        .getClientCapabilities;
    }
  });
});
