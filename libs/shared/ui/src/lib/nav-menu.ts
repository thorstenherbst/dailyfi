import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { Icon, IconName } from './icon';

/** Ein Ziel des Rund-Menues. */
export interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: IconName;
}

/**
 * `closed`: zu. `hover`: per Maus geoeffnet, schliesst nach dem Verlassen.
 * `pinned`: per Klick oder Tastatur geoeffnet, bleibt bis Esc, Tab heraus
 * oder Klick ausserhalb.
 */
type MenuMode = 'closed' | 'hover' | 'pinned';

/** Fallbacks, falls die Custom Properties (Styles-Lib) nicht geladen sind. */
const OPEN_DELAY_MS = 80;
const CLOSE_DELAY_MS = 400;

let nextId = 0;

/**
 * Schwebendes Rund-Menue unten links.
 *
 * Bedienung:
 * - Maus: oeffnet nach 80 ms Verweilen; eine unsichtbare Bruecke (300 × 200 px)
 *   haelt es offen; schliesst 400 ms nach Verlassen. Klick heftet an bzw.
 *   schliesst.
 * - Tastatur: Enter, Leertaste, ↑ oder → oeffnen und fokussieren das erste
 *   Ziel. ↓/→ naechstes, ↑/← voriges (im Kreis), Home/End. Esc schliesst und
 *   gibt den Fokus an den Ausloeser zurueck. Tab heraus schliesst.
 *
 * Geschlossen ist die Liste `inert` — sofort, nicht erst nach der
 * Schliess-Animation, sonst waeren die Ziele waehrend der 180 ms des
 * Ausblendens noch per Tab erreichbar.
 */
@Component({
  selector: 'app-nav-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, Icon],
  host: {
    class: 'fab',
    '[class.is-open]': 'open()',
    // Die unsichtbare Bruecke nur im Hover-Modus: angeheftet wuerde sie Klicks
    // ins Raster daneben schlucken.
    '[class.is-hover]': "mode() === 'hover'",
    '(pointerenter)': 'onPointerEnter($event)',
    '(pointerleave)': 'onPointerLeave($event)',
    '(focusout)': 'onFocusOut($event)',
  },
  styleUrl: './nav-menu.scss',
  template: `
    <!-- Auslöser in der Landmarke: so ist „Hauptnavigation" auch im
         geschlossenen Zustand nicht leer. -->
    <nav aria-label="Hauptnavigation">
      <button
        #trigger
        class="fab-trigger"
        type="button"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listId"
        [attr.aria-label]="open() ? 'Navigation schließen' : 'Navigation öffnen'"
        (click)="onTriggerClick($event)"
        (keydown)="onTriggerKeydown($event)"
      >
        <app-icon [name]="open() ? 'close' : 'menu'" />
      </button>
      <ul class="fab-menu" [id]="listId" [attr.inert]="open() ? null : ''">
        @for (item of items(); track item.path; let index = $index) {
          <li>
            <a
              #link
              [routerLink]="item.path"
              routerLinkActive
              #active="routerLinkActive"
              ariaCurrentWhenActive="page"
              (keydown)="onItemKeydown($event, index)"
              (click)="onItemClick()"
            >
              <app-icon [name]="item.icon" />
              <span class="fab-label">
                {{ item.label }}
                @if (active.isActive) {
                  <span class="current">· aktuell</span>
                }
              </span>
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
})
export class NavMenu {
  readonly items = input.required<readonly NavItem[]>();

  protected readonly listId = `nav-menu-${++nextId}`;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly triggerRef = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly linkRefs = viewChildren<ElementRef<HTMLAnchorElement>>('link');

  protected readonly mode = signal<MenuMode>('closed');
  protected readonly open = computed(() => this.mode() !== 'closed');

  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Capture-Phase: Das Raster ruft am Block `stopPropagation()` auf (Geste),
    // in der Bubble-Phase kaeme der Klick hier nie an.
    const onDocumentPointerDown = (event: PointerEvent): void => {
      if (this.mode() === 'pinned' && !this.host.nativeElement.contains(event.target as Node)) {
        this.close(false);
      }
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, { capture: true });
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, { capture: true });
      this.clearTimers();
    });
  }

  /* -- Maus ------------------------------------------------------------- */

  protected onPointerEnter(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') {
      return;
    }
    clearTimeout(this.closeTimer);
    if (this.mode() === 'closed') {
      this.openTimer = setTimeout(
        () => this.mode.set('hover'),
        this.delay('--dur-open-delay', OPEN_DELAY_MS),
      );
    }
  }

  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') {
      return;
    }
    clearTimeout(this.openTimer);
    if (this.mode() === 'hover') {
      this.closeTimer = setTimeout(
        () => {
          // Wer inzwischen per Tastatur in den Zielen steht, behaelt das Menue.
          const active = document.activeElement;
          if (!this.host.nativeElement.contains(active) || active === this.trigger) {
            this.close(false);
          }
        },
        this.delay('--dur-close-delay', CLOSE_DELAY_MS),
      );
    }
  }

  /**
   * Maus (`detail >= 1`) und Klicks ohne Zeiger (`detail === 0`: Screenreader,
   * Sprachsteuerung). Enter und Leertaste kommen hier nicht an: der keydown
   * ruft `preventDefault()`, und danach schickt der Browser keinen Klick mehr.
   * Darum braucht es kein Verschlucken — und keinen Merker, der haengen bliebe.
   */
  protected onTriggerClick(event: MouseEvent): void {
    if (this.mode() === 'pinned') {
      this.close(false);
      return;
    }
    this.clearTimers();
    this.mode.set('pinned');
    // Ein Klick ohne Zeiger (Screenreader, Sprachsteuerung): wie Tastatur.
    if (event.detail === 0) {
      this.focusItem(0);
    }
  }

  /* -- Tastatur --------------------------------------------------------- */

  protected onTriggerKeydown(event: KeyboardEvent): void {
    const { key } = event;
    if (key === 'Enter' || key === ' ' || key === 'ArrowUp' || key === 'ArrowRight') {
      // Unterdrueckt auch den Klick, den Enter/Leertaste sonst ausloesten.
      event.preventDefault();
      if (this.mode() === 'pinned' && (key === 'Enter' || key === ' ')) {
        this.close(false);
        return;
      }
      this.clearTimers();
      this.mode.set('pinned');
      this.focusItem(0);
    } else if (key === 'Escape' && this.open()) {
      event.preventDefault();
      this.close(true);
    }
  }

  protected onItemKeydown(event: KeyboardEvent, index: number): void {
    const count = this.items().length;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (index + 1) % count;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (index - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      case 'Escape':
        event.preventDefault();
        this.close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    this.focusItem(next);
  }

  /** Nach der Navigation zu und Fokus auf den Ausloeser — sonst laege er im `inert`. */
  protected onItemClick(): void {
    this.close(true);
  }

  /** Tab (oder ein Klick) aus dem Menue heraus schliesst es. */
  protected onFocusOut(event: FocusEvent): void {
    if (!this.open()) {
      return;
    }
    const next = event.relatedTarget as Node | null;
    if (next && !this.host.nativeElement.contains(next)) {
      this.close(false);
    }
  }

  /* -- intern ----------------------------------------------------------- */

  private get trigger(): HTMLButtonElement {
    return this.triggerRef().nativeElement;
  }

  private close(returnFocus: boolean): void {
    this.clearTimers();
    this.mode.set('closed');
    if (returnFocus) {
      this.trigger.focus();
    }
  }

  /**
   * Erst nach dem Rendern: vorher sind die Ziele noch `inert` und
   * `visibility: hidden`, und der Browser nimmt den Fokus nicht an.
   */
  private focusItem(index: number): void {
    afterNextRender(() => this.linkRefs()[index]?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  private clearTimers(): void {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
  }

  /** Dauer aus `--dur-*` (Styles-Lib), damit CSS und JS eine Quelle haben. */
  private delay(property: string, fallback: number): number {
    const raw = getComputedStyle(this.host.nativeElement).getPropertyValue(property).trim();
    const match = /^([\d.]+)(ms|s)$/.exec(raw);
    if (!match) {
      return fallback;
    }
    const value = Number(match[1]);
    return match[2] === 's' ? value * 1000 : value;
  }
}
