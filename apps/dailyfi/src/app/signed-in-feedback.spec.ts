import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { UserFeedback } from '@lib/shared/data-access-supabase';
import { ToastService } from '@lib/shared/ui';

import { signedInFeedback } from './signed-in-feedback';

describe('signedInFeedback', () => {
  it('reicht Meldungen durch, solange jemand angemeldet ist', () => {
    const toasts = TestBed.inject(ToastService);
    const feedback = signedInFeedback(toasts, signal(true));

    feedback.error('Die Änderung konnte nicht gespeichert werden.', {
      detail: 'Keine Verbindung zum Server.',
    });

    expect(toasts.toasts().map((toast) => toast.message)).toEqual([
      'Die Änderung konnte nicht gespeichert werden.',
    ]);
  });

  /**
   * Ablauf: 401 → Refresh laeuft verzoegert → „Abmelden" → die
   * Shell leert die Toasts → erst danach meldet der Store seinen Fehler. Auf
   * /login stand dann „Die Anmeldung war abgelaufen.".
   */
  it('verwirft Meldungen, die erst nach dem eigenen Abmelden eintreffen', () => {
    const toasts = TestBed.inject(ToastService);
    const signedIn = signal(true);
    const feedback = signedInFeedback(toasts, signedIn);

    // Abmelden: Sitzung weg, Shell leert die Toasts …
    signedIn.set(false);
    toasts.clear();
    // … und dann kommt der verspaetete Fehler des Stores.
    const id = feedback.error('Der Eintrag konnte nicht gespeichert werden.', {
      detail: 'Die Anmeldung war abgelaufen.',
    });
    feedback.success('Eintrag gespeichert');

    expect(id).toBe(0);
    expect(toasts.toasts()).toEqual([]);
  });

  it('nimmt auch abgemeldet noch Meldungen weg (dismiss)', () => {
    const sink: UserFeedback = {
      success: vi.fn(() => 1),
      error: vi.fn(() => 1),
      dismiss: vi.fn(),
    };
    const feedback = signedInFeedback(sink, signal(false));

    feedback.dismiss(7);

    expect(sink.dismiss).toHaveBeenCalledWith(7);
  });
});
