import { Signal, WritableSignal, computed, linkedSignal, signal } from '@angular/core';

/** Feldwerte, wie ein Formular sie zeigt: alles Text (auch Interfaces). */
export type FieldValues<V = Record<string, string>> = { readonly [K in keyof V]: string };

interface Overlay<V extends FieldValues<V>> {
  /** Was getippt wurde — nur diese Felder. */
  readonly edits: Partial<V>;
  /** Stand der Quelle in genau diesen Feldern, als sie (wieder) getippt wurden. */
  readonly base: Partial<V>;
}

const NONE: Overlay<Record<string, string>> = { edits: {}, base: {} };

export interface EditSessionOptions {
  /**
   * Laeuft gerade ein Schreibvorgang auf den Datensatz der Quelle, der nicht
   * von dieser Sitzung kommt (z. B. eine Tastaturbewegung im Raster)? Solange
   * ja, kann die Quelle optimistisch vorauseilen — getippte Felder fallen dann
   * nicht aus dem Overlay, auch wenn die Quelle gerade genau so aussieht.
   * Wird in einem `computed` gelesen und muss selbst aus Signals lesen.
   */
  readonly pending?: () => boolean;
}

function none<V extends FieldValues<V>>(): Overlay<V> {
  return NONE as unknown as Overlay<V>;
}

/**
 * Getipptes ueber einer gespeicherten Quelle, und was wartet, bis es
 * gespeichert oder verworfen ist. Gemeinsamer Kern von Detail-Panel (/week)
 * und Inline-Zeile (/projects).
 *
 * **Overlay.** Die Feldwerte sind kein eigener Zustand, sondern das Getippte
 * Feld fuer Feld **ueber** der Quelle (`values`). Aendert sich die Quelle,
 * folgen alle nicht getippten Felder von selbst.
 *
 * - Ein getipptes Feld, das sich in der Quelle auf einen **anderen** Wert
 *   aendert, ist ein Konflikt (`conflictKeys`): nichts wird ueberschrieben.
 * - Aendert sich die Quelle auf **genau** den getippten Wert, ist das Feld nicht
 *   mehr getippt — es faellt aus dem Overlay und folgt wieder der Quelle.
 *   Sonst bliebe das Formular „ungespeichert", und Speichern schickte einen
 *   identischen Schreibzugriff. Das gilt nur fuer einen **bestaetigten** Stand:
 *   nicht waehrend des eigenen Speicherns und nicht, solange ein fremder
 *   Schreibvorgang auf den Datensatz laeuft (`options.pending`). In beiden
 *   Faellen kann die Quelle optimistisch schon so aussehen und bei einem Fehler
 *   zurueckfallen — das Getippte muss dann noch da sein.
 *
 * **Vertrag „Rollback vor Ende".** Scheitert ein Schreibvorgang, muss der
 * Store die Quelle **zuerst** zuruecksetzen und erst danach melden, dass er
 * fertig ist: beim eigenen Speichern also Rollback, dann `saveFailed()`; bei
 * einem fremden Schreibvorgang Rollback, dann `pending()` → `false`. Endete der
 * Schreibvorgang vor dem Rollback, saehe die Sitzung kurz einen „bestaetigten"
 * optimistischen Stand, und das gleich lautende Getippte fiele heraus.
 * - Wird ein Feld (wieder) ins Overlay aufgenommen, gilt als Basis der
 *   **aktuelle** Stand der Quelle, nicht der vom ersten Tippen. Sonst meldete
 *   „Bis 10:15 getippt → Raster folgt auf 10:15 → Bis 10:00 getippt" mitten im
 *   Tippen einen Konflikt.
 *
 * **Absichten.** `request` sagt, ob eine Absicht (eine andere Zeile, die Route
 * verlassen …) sofort laufen darf. Nein, solange gespeichert wird (sie wartet
 * still auf das Ergebnis) oder Getipptes da ist (dann steht der Hinweis
 * „Ungespeicherte Änderungen"). Ausfuehren muss der Aufrufer; hier steht nur,
 * *ob* und *was* wartet.
 *
 * Die Klasse kennt weder DOM noch Store; nur Signals. Was „die Quelle" ist
 * (welcher Eintrag, welche Zeile), entscheidet der Aufrufer — wechselt er sie,
 * ruft er `restart()`.
 */
export class EditSession<V extends FieldValues<V>, A> {
  private readonly source: Signal<V | null>;
  private readonly overlay: WritableSignal<Overlay<V>>;
  private readonly parked = signal<A | null>(null);
  /** Zaehlt jede geparkte Absicht — der Hinweis sagt sich damit neu an. */
  private readonly parkCount = signal(0);
  private readonly saving = signal(false);
  /** Stand der Hinweis schon, als das Speichern begann? Dann bleibt er (gesperrt) stehen. */
  private readonly held = signal(false);

  /**
   * @param sourceOf Gespeicherter Stand, `null`: gibt es nicht (mehr). Wird in
   *   einem `computed` gelesen und muss deshalb selbst aus Signals lesen.
   * @param options `pending`: laeuft ein fremder Schreibvorgang (siehe oben).
   */
  constructor(sourceOf: () => V | null, options: EditSessionOptions = {}) {
    const pending = options.pending ?? (() => false);
    this.source = computed(sourceOf);
    this.overlay = linkedSignal<{ source: V | null; confirmed: boolean }, Overlay<V>>({
      source: () => ({ source: this.source(), confirmed: !this.saving() && !pending() }),
      computation: (now, previous) =>
        previous && now.confirmed
          ? settle(previous.value, now.source)
          : (previous?.value ?? none()),
    });
  }

  /** Quelle plus Getipptes; `null`, wenn es keine Quelle gibt. */
  readonly values: Signal<V | null> = computed(() => {
    const source = this.source();
    return source ? { ...source, ...this.overlay().edits } : null;
  });

  /** Nur die getippten Felder. */
  readonly edits: Signal<Partial<V>> = computed(() => this.overlay().edits);

  readonly dirty: Signal<boolean> = computed(
    () => this.source() !== null && Object.keys(this.overlay().edits).length > 0,
  );

  /**
   * Getippte Felder, die sich seitdem in der Quelle geaendert haben — auf einen
   * anderen Wert als den getippten. Waehrend des eigenen Speicherns keine: dann
   * aendert sie das Speichern selbst.
   */
  readonly conflictKeys: Signal<(keyof V)[]> = computed(() => {
    const source = this.source();
    const { edits, base } = this.overlay();
    if (!source || this.saving() || !this.dirty()) {
      return [];
    }
    return (Object.keys(edits) as (keyof V)[]).filter(
      (key) => source[key] !== base[key] && source[key] !== edits[key],
    );
  });

  readonly conflict: Signal<boolean> = computed(() => this.conflictKeys().length > 0);

  /**
   * Steht der Hinweis „Ungespeicherte Änderungen"? Eine erst waehrend des
   * Speicherns geparkte Absicht wartet still auf das Ergebnis — kein Hinweis.
   * Stand er schon vorher (sein „Speichern" laeuft), bleibt er bis zum Ergebnis
   * stehen.
   */
  readonly notice: Signal<boolean> = computed(
    () =>
      this.held() ||
      (this.parked() !== null && this.dirty() && !this.saving()) ||
      this.conflict(),
  );

  /** Wechselt bei jeder neu geparkten Absicht, auch derselben. */
  readonly noticeRevision: Signal<number> = this.parkCount.asReadonly();
  readonly busy: Signal<boolean> = this.saving.asReadonly();
  /** Die geparkte Absicht (ohne sie herauszunehmen). */
  readonly pending: Signal<A | null> = this.parked.asReadonly();

  /* -- Felder ------------------------------------------------------------- */

  /**
   * Ein Feld getippt. Steht es danach auf dem gespeicherten Wert, ist es nicht
   * mehr getippt — und folgt wieder der Quelle. Ist danach gar nichts mehr
   * getippt, erledigt sich auch eine geparkte Absicht: es gibt nichts mehr zu
   * speichern oder zu verwerfen, und sie liefe sonst spaeter unverhofft los.
   */
  change<K extends keyof V>(key: K, value: V[K]): void {
    const current = this.values();
    const source = this.source();
    if (!current || !source || current[key] === value) {
      return;
    }
    this.overlay.update(({ edits, base }) => {
      const nextEdits: Partial<V> = { ...edits };
      const nextBase: Partial<V> = { ...base };
      if (value === source[key]) {
        delete nextEdits[key];
        delete nextBase[key];
      } else {
        // (Wieder) aufgenommen: Basis ist der Stand der Quelle *jetzt*.
        nextBase[key] = key in edits ? base[key] : source[key];
        nextEdits[key] = value;
      }
      return { edits: nextEdits, base: nextBase };
    });
    if (!this.saving() && Object.keys(this.overlay().edits).length === 0) {
      this.parked.set(null);
    }
  }

  /** Getipptes verwerfen; eine geparkte Absicht bleibt. */
  discard(): void {
    this.overlay.set(none());
  }

  /** Neue Quelle (andere Zeile, anderer Eintrag): nichts getippt, nichts geparkt. */
  restart(): void {
    this.overlay.set(none());
    this.parked.set(null);
  }

  /* -- Absichten ---------------------------------------------------------- */

  /**
   * Darf die Absicht sofort laufen? Sonst wird sie geparkt (die letzte gewinnt)
   * und, ausser waehrend des Speicherns, der Hinweis gezeigt.
   */
  request(action: A): boolean {
    if (!this.saving() && !this.dirty()) {
      this.parked.set(null);
      return true;
    }
    this.parked.set(action);
    this.parkCount.update((count) => count + 1);
    return false;
  }

  /** Die geparkte Absicht herausnehmen (nach „Speichern"/„Verwerfen"). */
  takePending(): A | null {
    const action = this.parked();
    this.parked.set(null);
    return action;
  }

  /** Ohne Ausfuehren vergessen (die Absicht hat sich erledigt). */
  dropPending(): void {
    this.parked.set(null);
  }

  /* -- Speichern ---------------------------------------------------------- */

  beginSave(): void {
    this.held.set(this.notice());
    this.saving.set(true);
  }

  /**
   * Gespeichert: Getipptes ist ab jetzt der gespeicherte Stand und kommt wieder
   * aus der Quelle. Eine waehrenddessen geparkte Absicht bleibt stehen; der
   * Aufrufer nimmt sie mit `takePending()` heraus und fuehrt sie aus.
   */
  saved(): void {
    this.saving.set(false);
    this.held.set(false);
    this.overlay.set(none());
  }

  /**
   * Gescheitert: Eingaben und eine geparkte Absicht bleiben stehen. Erst
   * aufrufen, wenn der Store die Quelle zurueckgesetzt hat (Vertrag oben).
   */
  saveFailed(): void {
    this.saving.set(false);
    this.held.set(false);
  }
}

/** Felder, die die Quelle inzwischen genau so hat wie getippt, fallen heraus. */
function settle<V extends FieldValues<V>>(overlay: Overlay<V>, source: V | null): Overlay<V> {
  if (!source) {
    return overlay;
  }
  const same = (Object.keys(overlay.edits) as (keyof V)[]).filter(
    (key) => overlay.edits[key] === source[key],
  );
  if (same.length === 0) {
    return overlay;
  }
  const edits: Partial<V> = { ...overlay.edits };
  const base: Partial<V> = { ...overlay.base };
  for (const key of same) {
    delete edits[key];
    delete base[key];
  }
  return { edits, base };
}
