/**
 * Vorbereitung fuer Vitest.
 *
 * jsdom kennt `<dialog>`, aber nicht `showModal()` und `close()`. Beide
 * Dialoge der Anwendung verlassen sich bewusst auf das native Element (Fokus-
 * falle und Esc kommen damit vom Browser). Damit sie sich trotzdem testen
 * lassen, kommen die beiden Methoden hier minimal nach: Sie setzen nur das
 * `open`-Attribut und loesen `close` aus — genug, um Inhalt und Fokusfuehrung
 * zu pruefen, aber ausdruecklich kein Ersatz fuer einen echten Browser.
 */
const dialogPrototype = globalThis.HTMLDialogElement?.prototype as
  (HTMLDialogElement & { showModal?: () => void; close?: () => void }) | undefined;

if (dialogPrototype && typeof dialogPrototype.showModal !== 'function') {
  dialogPrototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };
  dialogPrototype.close = function close(this: HTMLDialogElement): void {
    if (!this.hasAttribute('open')) {
      return;
    }
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
