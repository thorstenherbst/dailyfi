import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'menu'
  | 'close'
  | 'week'
  | 'projects'
  | 'reports'
  | 'left'
  | 'right'
  | 'plus'
  | 'check'
  | 'ok'
  | 'sync'
  | 'warn'
  | 'info'
  | 'error'
  | 'mail'
  | 'download'
  | 'trash'
  | 'monitor'
  | 'lock'
  | 'pencil'
  | 'archive'
  | 'restore';

/**
 * Strich-Symbole (24er-Raster, `currentColor`). Immer
 * dekorativ (`aria-hidden`): die Bedeutung steht als Text oder `aria-label`
 * am umgebenden Element. Feste Pfade statt `innerHTML`, damit nichts am
 * Sanitizer vorbei muss.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'icon' },
  styleUrl: './icon.scss',
  template: `
    <svg viewBox="0 0 24 24" focusable="false">
      @switch (name()) {
        @case ('menu') {
          <circle cx="7" cy="7" r="2" />
          <circle cx="17" cy="7" r="2" />
          <circle cx="7" cy="17" r="2" />
          <circle cx="17" cy="17" r="2" />
        }
        @case ('close') {
          <path d="M6 6l12 12M18 6L6 18" />
        }
        @case ('week') {
          <rect x="3" y="4.5" width="18" height="16" rx="2" />
          <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
        }
        @case ('projects') {
          <path
            d="M3 6.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
          />
        }
        @case ('reports') {
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        }
        @case ('left') {
          <path d="M15 5l-7 7 7 7" />
        }
        @case ('right') {
          <path d="M9 5l7 7-7 7" />
        }
        @case ('plus') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('check') {
          <path d="M5 12.5l4.5 4.5L19 7" />
        }
        @case ('ok') {
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l3 3 5-6" />
        }
        @case ('sync') {
          <path d="M5 12a7 7 0 0 1 12-5l2 2M19 12a7 7 0 0 1-12 5l-2-2" />
          <path d="M19 4v5h-5M5 20v-5h5" />
        }
        @case ('warn') {
          <path d="M12 3.5L2.5 20h19z" />
          <path d="M12 10v4.5M12 17.5v.5" />
        }
        @case ('info') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5.5M12 7.5v.5" />
        }
        @case ('error') {
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        }
        @case ('mail') {
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3.5 6.5l8.5 6 8.5-6" />
        }
        @case ('download') {
          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        }
        @case ('trash') {
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        }
        @case ('lock') {
          <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
          <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
        }
        @case ('pencil') {
          <path d="M4 20h4L19 9l-4-4L4 16z" />
        }
        @case ('archive') {
          <rect x="3" y="4" width="18" height="5" rx="1" />
          <path d="M5 9v10h14V9M10 13h4" />
        }
        @case ('restore') {
          <path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5" />
          <path d="M4 4v4.5h4.5" />
        }
        @case ('monitor') {
          <rect x="2.5" y="4" width="19" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
}
