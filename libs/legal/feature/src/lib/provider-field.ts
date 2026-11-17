import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { isPlaceholder } from '@lib/legal/domain';

/**
 * Eine Angabe aus `PROVIDER`. Ein Platzhalter wie `[[PLZ Ort]]` erscheint
 * hervorgehoben (`.placeholder`), eine echte Angabe als Text — bei
 * `link="mail"` oder `link="tel"` als Link.
 */
@Component({
  selector: 'app-provider-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (placeholder()) {
      <mark class="placeholder">{{ value() }}</mark>
    } @else if (href(); as target) {
      <a [href]="target">{{ value() }}</a>
    } @else {
      {{ value() }}
    }
  `,
})
export class ProviderField {
  readonly value = input.required<string>();
  readonly link = input<'mail' | 'tel' | null>(null);

  protected readonly placeholder = computed(() => isPlaceholder(this.value()));

  protected readonly href = computed(() => {
    const value = this.value().trim();
    if (this.link() === 'mail') {
      return `mailto:${value}`;
    }
    if (this.link() === 'tel') {
      return `tel:${value.replace(/[^\d+]/g, '')}`;
    }
    return null;
  });
}
