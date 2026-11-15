import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, OnDestroy, computed, inject, input, signal } from '@angular/core';

/**
 * Wie lange ein Tooltip nach dem Verlassen des Zeigers noch steht. So kann man
 * den Zeiger auf einem Umweg (an einem Nachbarknopf vorbei) auf den Tooltip
 * fuehren, ohne dass er verschwindet.
 */
export const TOOLTIP_HIDE_DELAY_MS = 400;

/** Hoechstens ein Tooltip zugleich — sonst laegen zwei an derselben Stelle. */
const shown = signal<Tooltip | null>(null);

/**
 * Kurzer sichtbarer Name zu einem Icon-Button (Brief: Icon-Button „immer mit
 * `aria-label`"). Der Screenreader liest das `aria-label`; der Tooltip ist fuer
 * Sehende und erscheint bei Hover **und** Tastaturfokus.
 *
 * WCAG 1.4.13 (Inhalt bei Hover/Fokus):
 * - schliessbar: Esc blendet ihn aus, bis Zeiger oder Fokus das Element
 *   verlassen — auch ohne Fokus, solange der Zeiger darauf steht (dann hoert
 *   das Dokument auf Esc, nur so lange);
 * - ueberfahrbar: der Tooltip gehoert als `::after` zum Element; nach dem
 *   Verlassen bleibt er `TOOLTIP_HIDE_DELAY_MS` stehen, damit der Weg zu ihm
 *   nicht ueber ein anderes Bedienelement fuehren muss;
 * - bestaendig: er bleibt, solange Hover oder Fokus bleiben.
 *
 * Wo er steht, sagt das CSS (`_tooltip.scss`): standardmaessig ueber dem
 * Element; in einer Gruppe (`.tooltip-group`, z. B. Aktionsspalte einer
 * Tabelle) links neben der ganzen Gruppe, damit er nie einen Nachbarknopf oder
 * die Zeile darueber verdeckt.
 */
@Directive({
  selector: '[appTooltip]',
  host: {
    '[attr.data-tooltip]': 'appTooltip()',
    '[class.tooltip-on]': 'visible()',
    '(mouseenter)': 'onEnter()',
    '(mouseleave)': 'onLeave()',
    '(focus)': 'onFocus()',
    '(blur)': 'onBlur()',
    '(keydown.escape)': 'dismiss()',
  },
})
export class Tooltip implements OnDestroy {
  readonly appTooltip = input.required<string>();

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);

  private readonly dismissed = signal(false);
  private hovered = false;
  private focused = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private listening = false;

  protected readonly visible = computed(() => shown() === this && !this.dismissed());

  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.dismiss();
    }
  };

  protected onEnter(): void {
    this.cancelHide();
    this.hovered = true;
    // Neu darauf: ein frueheres Esc gilt nicht mehr.
    this.dismissed.set(false);
    this.show();
    // Esc ohne Fokus: das Element bekommt keinen Tastendruck, das Dokument schon.
    if (!this.listening) {
      this.document.addEventListener('keydown', this.onDocumentKeydown);
      this.listening = true;
    }
  }

  protected onLeave(): void {
    this.hovered = false;
    this.stopListening();
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.hovered && !this.focused) {
        this.hide();
      }
    }, TOOLTIP_HIDE_DELAY_MS);
  }

  protected onFocus(): void {
    // Nur bei sichtbarem Fokus (Tastatur), nicht nach einem Mausklick.
    if (this.element.matches(':focus-visible')) {
      this.focused = true;
      this.show();
    }
  }

  protected onBlur(): void {
    this.focused = false;
    if (!this.hovered) {
      this.cancelHide();
      this.hide();
    }
  }

  protected dismiss(): void {
    this.dismissed.set(true);
  }

  ngOnDestroy(): void {
    this.cancelHide();
    this.stopListening();
    if (shown() === this) {
      shown.set(null);
    }
  }

  private show(): void {
    if (shown() !== this) {
      shown.set(this);
    }
  }

  private hide(): void {
    this.dismissed.set(false);
    if (shown() === this) {
      shown.set(null);
    }
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private stopListening(): void {
    if (this.listening) {
      this.document.removeEventListener('keydown', this.onDocumentKeydown);
      this.listening = false;
    }
  }
}
