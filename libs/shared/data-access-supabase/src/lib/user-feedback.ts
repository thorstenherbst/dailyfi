import { InjectionToken } from '@angular/core';

/**
 * Rueckmeldung an den Menschen vor dem Bildschirm, aus Sicht eines Stores.
 *
 * Die Stores (`type:data-access`) duerfen die Toasts in `shared/ui` nicht
 * kennen. Sie melden deshalb nur hierher; die App bindet das Token an den
 * `ToastService` (`app.config.ts`). Ohne Bindung — in Tests, die das nicht
 * pruefen — geht die Meldung ins Leere.
 *
 * `detail` ist der zweite, leisere Teil: „Speichern fehlgeschlagen." +
 * „Keine Verbindung zum Server."
 *
 * Jede Meldung liefert eine Kennung zurueck. Mit `dismiss()` nimmt der Store
 * eine Meldung wieder weg, die nicht mehr stimmt — etwa den Ladefehler, nachdem
 * „Erneut laden" geklappt hat.
 */
export interface UserFeedback {
  success(message: string, options?: { readonly detail?: string }): number;
  error(message: string, options?: { readonly detail?: string }): number;
  dismiss(id: number): void;
}

const SILENT: UserFeedback = {
  success: () => 0,
  error: () => 0,
  dismiss: () => undefined,
};

export const USER_FEEDBACK = new InjectionToken<UserFeedback>('USER_FEEDBACK', {
  providedIn: 'root',
  factory: () => SILENT,
});

/**
 * Eine Fehlermeldung, die nur gilt, bis es wieder klappt — der Ladefehler
 * einer Seite. Nach erfolgreichem „Erneut laden" nimmt `dismiss()` sie weg;
 * ein anderer Fehler ersetzt sie, derselbe zaehlt im Toast hoch.
 */
export class TransientErrorFeedback {
  private id: number | null = null;

  constructor(private readonly feedback: UserFeedback) {}

  error(message: string, options?: { readonly detail?: string }): void {
    const id = this.feedback.error(message, options);
    if (this.id !== null && this.id !== id) {
      this.feedback.dismiss(this.id);
    }
    this.id = id;
  }

  dismiss(): void {
    if (this.id !== null) {
      this.feedback.dismiss(this.id);
      this.id = null;
    }
  }
}
