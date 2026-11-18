import { Injectable, computed, signal } from '@angular/core';

/**
 * Der entsperrte Datenschluessel, nur im Arbeitsspeicher. Gesetzt wird er von
 * der Kontoverwaltung (`auth/data-access`) nach dem Entsperren, gelesen von
 * den Repositories, die Inhalte ver- und entschluesseln. Neu laden, Abmelden
 * oder ein Kontowechsel leeren ihn — danach fragt die Anwendung wieder nach
 * dem Passkey.
 *
 * Der Schluessel ist nicht exportierbar (`lockDown`): auch wer Code in die
 * Seite bekommt, kann ihn benutzen, solange die Seite offen ist, aber nicht
 * herausholen.
 */
@Injectable({ providedIn: 'root' })
export class DataKeyHolder {
  private readonly current = signal<CryptoKey | null>(null);

  readonly unlocked = computed(() => this.current() !== null);

  set(key: CryptoKey): void {
    this.current.set(key);
  }

  clear(): void {
    this.current.set(null);
  }

  /** Der Schluessel, oder ein Fehler, wenn die Anwendung gesperrt ist. */
  require(): CryptoKey {
    const key = this.current();
    if (!key) {
      throw new Error('Datenschluessel ist gesperrt.');
    }
    return key;
  }
}
