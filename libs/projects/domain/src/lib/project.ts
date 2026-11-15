export interface Client {
  readonly id: string;
  readonly name: string;
  readonly archivedAt: Date | null;
}

export interface ProjectRecord {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly color: string;
  readonly hourlyRate: number | null;
  readonly archivedAt: Date | null;
}

export interface ClientDraft {
  readonly name: string;
}

export interface ProjectDraft {
  readonly clientId: string;
  readonly name: string;
  readonly color: string;
  readonly hourlyRate: number | null;
}
