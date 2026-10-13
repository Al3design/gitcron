/**
 * Si el resumen «Dónde quedaste» sigue al día con el repo (retomar 3.2).
 * Se compara lo que había al leer el repo con lo que hay ahora: si cambió el HEAD
 * o los archivos con cambios sin confirmar del propio cambio, falta releer.
 */

export interface ResumeSourcesStamp {
  /** Cuándo se leyó el repo (ISO), o null si no se sabe. */
  readAt: string | null;
  /** El HEAD en ese momento, o null si no se sabe. */
  headSha: string | null;
  /** Archivos sin confirmar de `openspec/changes/<changeId>/`, ordenados. */
  changeFiles: string[];
}

export type ResumeFreshness =
  | { state: 'fresh' }
  | { state: 'pending'; reason: 'checkout' | 'sources' };

export function stampSources(
  readAt: string | null,
  headSha: string | null,
  modifiedPaths: string[],
  changeId: string,
): ResumeSourcesStamp {
  const prefix = `openspec/changes/${changeId}/`;
  const changeFiles = modifiedPaths
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => p.startsWith(prefix))
    .sort();
  return { readAt, headSha, changeFiles };
}

export function compareFreshness(atRead: ResumeSourcesStamp | null, now: ResumeSourcesStamp): ResumeFreshness {
  if (!atRead) return { state: 'fresh' };
  if (atRead.headSha !== null && now.headSha !== null && atRead.headSha !== now.headSha) {
    return { state: 'pending', reason: 'checkout' };
  }
  if (atRead.changeFiles.join('\n') !== now.changeFiles.join('\n')) {
    return { state: 'pending', reason: 'sources' };
  }
  return { state: 'fresh' };
}
