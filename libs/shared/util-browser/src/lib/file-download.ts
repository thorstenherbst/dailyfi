import { Injectable } from '@angular/core';

/**
 * Datei im Browser anbieten.
 *
 * Eigene Klasse, nicht eine Funktion im Bauteil: so laesst sich der Export
 * pruefen, ohne dass der Test einen Download ausloest — und `URL.createObjectURL`
 * gibt es in jsdom gar nicht.
 */
@Injectable({ providedIn: 'root' })
export class FileDownload {
  save(filename: string, content: string, mimeType = 'text/csv;charset=utf-8'): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();

    // Ohne dieses Freigeben haelt der Browser den Blob bis zum Neuladen fest.
    URL.revokeObjectURL(url);
  }
}
