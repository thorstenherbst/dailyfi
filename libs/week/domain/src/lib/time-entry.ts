/** Ein Projekt, so wie es das Raster braucht: Name, Farbe, Kunde. */
export interface Project {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly clientName: string;
}

/** Ein Zeiteintrag mit echten Zeitpunkten statt ISO-Strings. */
export interface TimeEntry {
  readonly id: string;
  readonly projectId: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly description: string;
}

export interface TimeEntryDraft {
  readonly projectId: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly description: string;
}
