export type ResumeNarrationSourceId = 'proposal' | 'tasks' | 'head';

export interface ResumeNarrationArgs {
  repoPath: string;
  changeId: string;
  // null = activo; YYYY-MM-DD = openspec/changes/archive/<fecha>-<changeId>
  archivedAt: string | null;
  language: 'es' | 'en' | 'zh';
}

export interface ResumeNarrationParagraph {
  text: string;
  sourceIds: ResumeNarrationSourceId[];
}

export interface ResumeNarrationData {
  paragraphs: ResumeNarrationParagraph[];
  sources: { id: ResumeNarrationSourceId; ref: string }[];
  fingerprint: string;
  createdAt: string;
  providerName: string;
  modelId: string;
}

export type ResumeNarrationResult =
  | { status: 'narrated'; data: ResumeNarrationData }
  | { status: 'unavailable' | 'stale'; message: string };
