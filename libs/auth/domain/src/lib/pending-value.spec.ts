import { forgetDpaConsent, readDpaConsent, rememberDpaConsent } from './pending-dpa-consent';
import { forgetInviteCode, readInviteCode, rememberInviteCode } from './pending-invite-code';

describe('Gemerkte Werte aus der Registrierung', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('gibt Code und Zustimmung fuer dieselbe Adresse heraus', () => {
    rememberInviteCode(' DAILYFI-DEV-2 ', 'Neu@Dailyfi.test ');
    rememberDpaConsent('1.0', 'neu@dailyfi.test');

    expect(readInviteCode('neu@dailyfi.test')).toBe('DAILYFI-DEV-2');
    expect(readDpaConsent(' NEU@dailyfi.test')).toBe('1.0');
  });

  it('verwirft sie fuer eine fremde Adresse', () => {
    rememberInviteCode('DAILYFI-DEV-2', 'a@dailyfi.test');
    rememberDpaConsent('1.0', 'a@dailyfi.test');

    expect(readInviteCode('b@dailyfi.test')).toBeNull();
    expect(readDpaConsent('b@dailyfi.test')).toBeNull();
    // Weg, nicht nur verborgen: auch A bekommt sie danach nicht mehr.
    expect(readInviteCode('a@dailyfi.test')).toBeNull();
    expect(readDpaConsent('a@dailyfi.test')).toBeNull();
  });

  it('liest einen Einladungscode im aelteren Format ohne Adresse', () => {
    localStorage.setItem(
      'dailyfi.pending-invite-code',
      JSON.stringify({ code: 'DAILYFI-DEV-2', savedAt: Date.now() }),
    );

    expect(readInviteCode('neu@dailyfi.test')).toBe('DAILYFI-DEV-2');
  });

  it('verwirft eine Zustimmung ohne Adresse', () => {
    localStorage.setItem(
      'dailyfi.pending-dpa-consent',
      JSON.stringify({ value: '1.0', savedAt: Date.now() }),
    );

    expect(readDpaConsent('neu@dailyfi.test')).toBeNull();
    expect(localStorage.getItem('dailyfi.pending-dpa-consent')).toBeNull();
  });

  it('laesst Werte nach einer Stunde verfallen', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
    rememberDpaConsent('1.0', 'neu@dailyfi.test');

    vi.setSystemTime(new Date('2026-11-17T11:00:01Z'));

    expect(readDpaConsent('neu@dailyfi.test')).toBeNull();
    expect(localStorage.getItem('dailyfi.pending-dpa-consent')).toBeNull();
  });

  it('vergisst auf Wunsch', () => {
    rememberInviteCode('DAILYFI-DEV-2', 'neu@dailyfi.test');
    rememberDpaConsent('1.0', 'neu@dailyfi.test');

    forgetInviteCode();
    forgetDpaConsent();

    expect(readInviteCode('neu@dailyfi.test')).toBeNull();
    expect(readDpaConsent('neu@dailyfi.test')).toBeNull();
  });
});
