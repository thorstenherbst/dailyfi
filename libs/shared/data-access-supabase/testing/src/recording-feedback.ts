import type { UserFeedback } from '../../src/lib/user-feedback';

export interface RecordedFeedback {
  readonly id: number;
  readonly kind: 'success' | 'error';
  readonly message: string;
  readonly detail?: string;
}

/** Haelt fest, was ein Store dem Nutzer melden wollte. */
export class RecordingFeedback implements UserFeedback {
  readonly messages: RecordedFeedback[] = [];
  /** Kennungen, die per `dismiss()` wieder weggenommen wurden. */
  readonly dismissed: number[] = [];
  private nextId = 0;

  success(message: string, options?: { readonly detail?: string }): number {
    return this.record('success', message, options);
  }

  error(message: string, options?: { readonly detail?: string }): number {
    return this.record('error', message, options);
  }

  dismiss(id: number): void {
    this.dismissed.push(id);
  }

  /** Was noch steht: gemeldet und nicht wieder weggenommen. */
  open(kind: RecordedFeedback['kind']): string[] {
    return this.messages
      .filter((entry) => entry.kind === kind && !this.dismissed.includes(entry.id))
      .map((entry) => [entry.message, entry.detail].filter(Boolean).join(' '));
  }

  private record(
    kind: RecordedFeedback['kind'],
    message: string,
    options?: { readonly detail?: string },
  ): number {
    const id = ++this.nextId;
    this.messages.push({ id, kind, message, detail: options?.detail });
    return id;
  }

  /** „Ueberschrift Detail" — so, wie es im Toast steht. */
  texts(kind: RecordedFeedback['kind']): string[] {
    return this.messages
      .filter((entry) => entry.kind === kind)
      .map((entry) => [entry.message, entry.detail].filter(Boolean).join(' '));
  }
}
