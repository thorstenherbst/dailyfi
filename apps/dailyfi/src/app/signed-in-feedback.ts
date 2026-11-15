import { Signal } from '@angular/core';

import { UserFeedback } from '@lib/shared/data-access-supabase';

/**
 * Rueckmeldungen der Stores, aber nur, solange jemand angemeldet ist.
 *
 * Der Fall dahinter: ein Zugriff scheitert mit 401, der Refresh steht noch an,
 * der Nutzer klickt „Abmelden". `SessionStore.tryRefresh()` liefert dann
 * `ended`, und der Store meldet seinen Fehler — aber erst, nachdem die Shell
 * die Toasts schon geleert hat. Auf `/login` stuende sonst
 * „… Die Anmeldung war abgelaufen." fuer eine Abmeldung, die gewollt war.
 *
 * Nach dem Abmelden gibt es nichts mehr, das ein Store sinnvoll melden koennte
 * (die Seiten sind weg); was noch eintrudelt, gehoert zur alten Sitzung und
 * wird verworfen. Waehrend einer *abgelaufenen* Sitzung ist der Nutzer noch
 * gesetzt — dort kommen Fehler wie bisher an.
 */
export function signedInFeedback(sink: UserFeedback, signedIn: Signal<boolean>): UserFeedback {
  return {
    success: (message, options) => (signedIn() ? sink.success(message, options) : 0),
    error: (message, options) => (signedIn() ? sink.error(message, options) : 0),
    dismiss: (id) => sink.dismiss(id),
  };
}
