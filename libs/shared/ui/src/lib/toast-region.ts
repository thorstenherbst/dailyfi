import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
} from '@angular/core';

import { Icon, IconName } from './icon';
import { Toast, ToastKind, ToastService } from './toast.service';

const KIND: Record<ToastKind, { icon: IconName; label: string }> = {
  info: { icon: 'info', label: 'Info' },
  success: { icon: 'ok', label: 'Erfolg' },
  warning: { icon: 'warn', label: 'Warnung' },
  error: { icon: 'error', label: 'Fehler' },
};

/**
 * Zeichnet die Toasts. Steht von Anfang an in der App-Shell, auch leer: Zwei
 * Live-Regionen, die erst mit der ersten Meldung entstuenden, registriert
 * mancher Screenreader gar nicht — und eine Region mit `display: none` faellt
 * aus dem Accessibility-Tree. Die Regionen sind deshalb dauerhaft gerendert
 * (visuell versteckt per `sr-only`, nie `display: none`).
 *
 * Ansage und Darstellung sind getrennt:
 * - Die Live-Regionen enthalten nur `announcements` — jede Meldung genau
 *   einmal, wenn sie entsteht. Ein Toast, der wegen des Limits erst spaeter
 *   nachrueckt, wird dadurch nicht ein zweites Mal vorgelesen.
 * - Der sichtbare Stapel ist keine Live-Region; dort liegen Schliessen und
 *   Aktion fuer Tastatur und Zeiger.
 *
 * `role="alert"` und `role="status"` sind implizit `aria-atomic="true"`: bei
 * jeder neuen Ansage laese ein Screenreader die ganze Region vor, also auch
 * alle noch stehenden Meldungen. Darum explizit `aria-atomic="false"` und
 * `aria-relevant="additions"` — vorgelesen wird nur das neu eingefuegte `<p>`.
 * (Die Alternative, Ansagen nach kurzer Zeit zu entfernen, braeuchte einen
 * weiteren Timer und haette dasselbe Ergebnis.)
 *
 * `role="alert"` (bestimmt) nur fuer Fehler, `role="status"` (hoeflich) fuer
 * Warnung, Info und Erfolg (Brief „Toast").
 *
 * Symbol **und** Text, nie nur Farbe; die Art steht zusaetzlich unsichtbar
 * vorn („Fehler:"), damit sie auch vorgelesen wird.
 *
 * Fokus nach dem Schliessen (per Knopf oder Aktion), wenn er im Toast lag:
 * zurueck auf das Element, das vor dem Betreten der Region fokussiert war;
 * gibt es das nicht mehr, auf „Schließen" des naechsten Toasts; sonst `main`.
 */
@Component({
  selector: 'app-toast-region',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    class: 'toast-region',
    '[class.has-status]': 'aboveStatusBar()',
    '(focusin)': 'onRegionFocusIn($event)',
  },
  template: `
    <div
      class="toast-live sr-only"
      role="alert"
      aria-live="assertive"
      aria-atomic="false"
      aria-relevant="additions"
    >
      @for (said of urgentSpoken(); track said.key) {
        <p>{{ kindOf(said.kind).label }}: {{ said.message }}{{ textAfter(said) }}</p>
      }
    </div>
    <div
      class="toast-live sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
    >
      @for (said of politeSpoken(); track said.key) {
        <p>{{ kindOf(said.kind).label }}: {{ said.message }}{{ textAfter(said) }}</p>
      }
    </div>

    <div class="toast-stack">
      @for (toast of stack(); track toast.id) {
        <div
          [class]="'toast is-' + toast.kind"
          [attr.data-toast-id]="toast.id"
          (mouseenter)="toasts.hold(toast.id, 'hover')"
          (mouseleave)="toasts.release(toast.id, 'hover')"
          (focusin)="toasts.hold(toast.id, 'focus')"
          (focusout)="onFocusOut($event, toast)"
        >
          <span class="toast-icon"><app-icon [name]="kindOf(toast.kind).icon" /></span>
          <p class="toast-text">
            <span class="sr-only">{{ kindOf(toast.kind).label }}: </span>
            <b>{{ toast.message }}</b>
            @if (toast.detail) {
              {{ textAfter(toast) }}
            }
            @if (toast.count > 1) {
              <span class="toast-count">({{ toast.count }}×)</span>
            }
          </p>
          @if (toast.action; as action) {
            <button class="btn-link toast-action" type="button" (click)="onAction(toast)">
              {{ action.label }}
            </button>
          }
          <button
            class="toast-close"
            type="button"
            aria-label="Meldung schließen"
            (click)="onClose(toast)"
          >
            <app-icon name="close" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastRegion {
  protected readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Mit Statusleiste 16 px darueber, sonst 16 px ueber dem Fensterrand. */
  readonly aboveStatusBar = input(false);

  /** Fehler oben, darunter der Rest — jeweils aelteste zuerst. */
  protected readonly stack = computed(() => {
    const visible = this.toasts.visible();
    return [
      ...visible.filter((toast) => toast.kind === 'error'),
      ...visible.filter((toast) => toast.kind !== 'error'),
    ];
  });

  protected readonly urgentSpoken = computed(() =>
    this.toasts.announcements().filter((said) => said.kind === 'error'),
  );
  protected readonly politeSpoken = computed(() =>
    this.toasts.announcements().filter((said) => said.kind !== 'error'),
  );

  /** Was vor dem Betreten der Region den Fokus hatte. */
  private focusOrigin: HTMLElement | null = null;

  protected kindOf(kind: ToastKind): { icon: IconName; label: string } {
    return KIND[kind];
  }

  /** „Speichern fehlgeschlagen. Keine Verbindung." vs. „Gespeichert · Relaunch". */
  protected textAfter(toast: { message: string; detail: string | null }): string {
    if (!toast.detail) {
      return '';
    }
    return `${/[.:!?]$/.test(toast.message) ? ' ' : ' · '}${toast.detail}`;
  }

  protected onRegionFocusIn(event: FocusEvent): void {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !this.host.nativeElement.contains(from)) {
      this.focusOrigin = from;
    }
  }

  protected onFocusOut(event: FocusEvent, toast: Toast): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as HTMLElement).contains(next)) {
      this.toasts.release(toast.id, 'focus');
    }
  }

  protected onClose(toast: Toast): void {
    this.leave(toast, () => this.toasts.dismiss(toast.id));
  }

  protected onAction(toast: Toast): void {
    this.leave(toast, () => this.toasts.runAction(toast.id));
  }

  /**
   * Der Toast verschwindet. Lag der Fokus darin, fiele er sonst auf `body`,
   * und die Tastaturbedienung finge oben auf der Seite neu an.
   */
  private leave(toast: Toast, run: () => void): void {
    const item = this.host.nativeElement.querySelector(`[data-toast-id="${toast.id}"]`);
    const hadFocus = item !== null && item.contains(document.activeElement);
    const position = this.stack().findIndex((candidate) => candidate.id === toast.id);

    run();

    if (hadFocus) {
      afterNextRender(() => this.restoreFocus(position), { injector: this.injector });
    }
  }

  private restoreFocus(position: number): void {
    const active = document.activeElement;
    // Eine Aktion hat den Fokus womoeglich selbst schon gesetzt.
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) {
      return;
    }

    const origin = this.focusOrigin;
    if (origin?.isConnected && !this.host.nativeElement.contains(origin)) {
      origin.focus();
      if (document.activeElement === origin) {
        return;
      }
    }

    const closers = [...this.host.nativeElement.querySelectorAll<HTMLElement>('.toast-close')];
    const next = closers[position] ?? closers[closers.length - 1];
    if (next) {
      next.focus();
      return;
    }

    document.querySelector<HTMLElement>('main')?.focus();
  }
}
