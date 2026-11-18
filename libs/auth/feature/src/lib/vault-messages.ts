import { SetUpFailure, VaultOutcome } from '@lib/auth/data-access';

const UNSUPPORTED =
  'Dieser Browser kann mit Passkeys keine Schlüssel ableiten. Nutze bitte Safari ab macOS 15 ' +
  'oder iOS 18 oder einen aktuellen Chrome.';
const FAILED = 'Das hat nicht geklappt. Bitte versuche es noch einmal.';

/** Ein Satz je Fehlschlag beim Einrichten. */
export function setUpMessage(reason: SetUpFailure): string {
  switch (reason) {
    case 'unsupported':
      return `${UNSUPPORTED} Wurde dabei schon ein Passkey für Dailyfi angelegt, kannst du ihn in den Passworteinstellungen löschen.`;
    case 'cancelled':
      return 'Abgebrochen. Du kannst es gleich noch einmal versuchen.';
    case 'busy-elsewhere':
      return (
        'In einem anderen Tab wird die Verschlüsselung gerade eingerichtet. Schließe die ' +
        'Einrichtung dort ab oder schließe den Tab.'
      );
    case 'save-failed':
      return 'Der Schlüssel konnte nicht gespeichert werden. Bitte versuche es noch einmal.';
    case 'already-set-up':
    case 'failed':
      return FAILED;
  }
}

/** Ein Satz je Fehlschlag beim Entsperren oder beim neuen Passkey. */
export function unlockMessage(outcome: Exclude<VaultOutcome, 'ok'>): string {
  switch (outcome) {
    case 'unsupported':
      return UNSUPPORTED;
    case 'cancelled':
      // Auch „kein passender Passkey auf diesem Gerät" — WebAuthn sagt es nicht.
      return (
        'Kein Passkey verwendet. Ist auf diesem Gerät keiner für Dailyfi gespeichert, nimm den ' +
        'Wiederherstellungsschlüssel.'
      );
    case 'wrong-key':
      return 'Dieser Passkey gehört nicht zu deinem Dailyfi-Konto.';
    case 'save-failed':
      return 'Der neue Passkey konnte nicht gespeichert werden. Bitte versuche es noch einmal.';
    case 'failed':
      return FAILED;
  }
}
